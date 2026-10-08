import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { validateCase, type CaseData, type CaseRecord } from '@medsim/core';
import { renderPortal, user, MODEL } from '../testUtils';
import { CAPTURED_VIEW } from '../testMocks';

vi.mock('../../viewer/ModelViewer', async () => ({ ModelViewer: (await import('../testMocks')).MockModelViewer }));
vi.mock('../../station/CasePlayer', async () => ({ CasePlayer: (await import('../testMocks')).MockCasePlayer }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const AUTHOR = user(['author'], 'author1');

function record(data: CaseData, extra: Partial<CaseRecord> = {}): CaseRecord {
  return { id: data.case_id, org_id: 'demo', course_id: 'c1', version: 1, status: 'draft', author_id: 'author1', data, model_version: 2, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', ...extra };
}

const SAMPLE: CaseData = {
  case_id: 'heart_ms_01', course: 'ANAT2', model: 'heart_v1', variant: 'mitral_stenosis',
  stem: { en: 'A 34-year-old woman with dyspnoea.', ar: 'امرأة عمرها 34 عاماً تعاني من ضيق التنفس.' },
  initial_view: { camera: 'anterior', hidden_layers: ['pericardium'] },
  feedback_level: 'full',
  questions: [{ id: 'q1', type: 'identify', prompt: 'Select the mitral valve', answer: ['TA:mitral_valve'], points: 2 }],
};

const change = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe('author case editor', () => {
  it('[T1-03] author form builds a valid case (model, variant, preset view, bilingual stem, questions, keys) and POSTs it', async () => {
    const r = renderPortal('/portal/cases/new', {
      as: AUTHOR,
      routes: [
        { method: 'POST', path: '/api/cases', reply: ({ body }) => record((body as { data: CaseData }).data) },
        { path: '/api/cases/new_case_1', reply: ({ path }) => record({ ...SAMPLE, case_id: path.split('/').pop()! }) },
        { path: /\/api\/cases\/new_case_1/, reply: record({ ...SAMPLE, case_id: 'new_case_1' }) },
      ],
    });
    await screen.findByTestId('case-id');
    change('case-id', 'new_case_1');
    change('case-variant', 'mitral_stenosis');
    change('case-camera', 'left');
    fireEvent.click(screen.getByTestId('hidden-pericardium'));
    fireEvent.click(screen.getByTestId('allowed-chambers'));
    fireEvent.click(screen.getByTestId('allowed-valves'));
    change('case-stem-en', 'A 60-year-old man with chest pain.');
    change('case-stem-ar', 'رجل عمره 60 عاماً يعاني من ألم في الصدر.');
    change('case-time', '15');
    change('case-feedback', 'full');
    change('case-difficulty', 'medium');
    change('case-objectives', 'Identify valves\nRelate stenosis to murmurs');
    // q1: MCQ with bilingual prompt, two options, key B, feedback
    change('q0-prompt-en', 'Which valve is affected?');
    change('q0-prompt-ar', 'أي صمام مصاب؟');
    change('q0-opt-0-en', 'Aortic');
    change('q0-opt-1-en', 'Mitral');
    change('q0-opt-1-ar', 'التاجي');
    fireEvent.click(screen.getByTestId('q0-correct-1'));
    change('q0-points', '2');
    change('q0-feedback-en', 'Mitral stenosis narrows the mitral orifice.');
    // q2: identify, choose target from list
    fireEvent.click(screen.getByTestId('add-question'));
    change('q1-type', 'identify');
    change('q1-prompt-en', 'Select the left ventricle');
    change('q1-add-target', 'TA:left_ventricle');
    // q3: multi with partial credit
    fireEvent.click(screen.getByTestId('add-question'));
    change('q2-type', 'multi');
    change('q2-prompt-en', 'Select all chambers');
    change('q2-opt-0-en', 'LV');
    change('q2-opt-1-en', 'RA');
    fireEvent.click(screen.getByTestId('q2-add-option'));
    change('q2-opt-2-en', 'Aorta');
    fireEvent.click(screen.getByTestId('q2-correct-0'));
    fireEvent.click(screen.getByTestId('q2-correct-1'));
    fireEvent.click(screen.getByTestId('q2-partial'));

    fireEvent.click(screen.getByTestId('save-case'));
    await waitFor(() => expect(r.api.find('POST', '/api/cases')).toHaveLength(1));
    const body = r.api.find('POST', '/api/cases')[0].body as { course_id: string; data: CaseData };
    expect(body.course_id).toBe('c1');
    const v = validateCase(body.data, MODEL);
    expect(v.ok, v.ok ? '' : v.errors.join('\n')).toBe(true);
    const d = body.data;
    expect(d).toMatchObject({
      case_id: 'new_case_1', course: 'ANAT2', model: 'heart_v1', variant: 'mitral_stenosis',
      stem: { en: 'A 60-year-old man with chest pain.', ar: 'رجل عمره 60 عاماً يعاني من ألم في الصدر.' },
      initial_view: { camera: 'left', hidden_layers: ['pericardium'] },
      allowed_layers: ['chambers', 'valves'], time_limit_min: 15, feedback_level: 'full',
      meta: { difficulty: 'medium', objectives: ['Identify valves', 'Relate stenosis to murmurs'] },
    });
    expect(d.questions[0]).toMatchObject({ id: 'q1', type: 'mcq', answer: 'B', points: 2, prompt: { en: 'Which valve is affected?', ar: 'أي صمام مصاب؟' }, options: { A: 'Aortic', B: { en: 'Mitral', ar: 'التاجي' } } });
    expect(d.questions[1]).toMatchObject({ id: 'q2', type: 'identify', answer: ['TA:left_ventricle'] });
    expect(d.questions[2]).toMatchObject({ type: 'multi', answer: ['A', 'B'], partial_credit: true });
  });

  it('[T1-03] client-side validation (core validateCase) blocks saving and lists errors', async () => {
    const r = renderPortal('/portal/cases/new', { as: AUTHOR, routes: [{ method: 'POST', path: '/api/cases', reply: {} }] });
    await screen.findByTestId('case-id');
    fireEvent.click(screen.getByTestId('save-case'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/case_id/);
    expect(alert.textContent).toMatch(/mcq needs exactly one answer key/);
    expect(r.api.find('POST', '/api/cases')).toHaveLength(0);
  });

  it('[T1-03] server validation errors are shown beneath the form', async () => {
    renderPortal('/portal/cases/heart_ms_01/edit', {
      as: AUTHOR,
      routes: [
        { path: '/api/cases/heart_ms_01', reply: record(SAMPLE) },
        { method: 'PUT', path: '/api/cases/heart_ms_01', status: 400, reply: { error: 'Invalid case', details: ['questions[0].answer: structure "TA:x" does not exist'] } },
      ],
    });
    await screen.findByTestId('case-id');
    fireEvent.click(screen.getByTestId('save-case'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/TA:x/);
  });

  it('[T2-01] clicking a structure in the 3D viewer adds/removes an identify target; capture view sets initial_view and question view', async () => {
    const r = renderPortal('/portal/cases/heart_ms_01/edit', {
      as: AUTHOR,
      routes: [
        { path: '/api/cases/heart_ms_01', reply: record(SAMPLE) },
        { method: 'PUT', path: '/api/cases/heart_ms_01', reply: ({ body }) => record((body as { data: CaseData }).data, { version: 1 }) },
      ],
    });
    const viewer = await screen.findByTestId('author-viewer');
    expect(viewer.dataset.selected).toBe('TA:mitral_valve');
    fireEvent.click(screen.getByTestId('author-viewer-pick-lv'));
    expect(screen.getByTestId('author-viewer').dataset.selected).toBe('TA:mitral_valve,TA:left_ventricle');
    expect(within(screen.getByTestId('q0-targets')).getByText('Left ventricle')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('author-viewer-pick-mv')); // toggles off
    expect(screen.getByTestId('author-viewer').dataset.selected).toBe('TA:left_ventricle');
    // capture camera view
    fireEvent.click(screen.getByTestId('author-viewer-rotate'));
    fireEvent.click(screen.getByTestId('capture-initial-view'));
    expect(screen.getByTestId('initial-view-desc').textContent).toMatch(/custom/);
    fireEvent.click(screen.getByTestId('q0-capture-view'));
    fireEvent.click(screen.getByTestId('save-case'));
    await waitFor(() => expect(r.api.find('PUT', '/api/cases/heart_ms_01')).toHaveLength(1));
    const data = (r.api.find('PUT', '/api/cases/heart_ms_01')[0].body as { data: CaseData }).data;
    expect(data.questions[0].answer).toEqual(['TA:left_ventricle']);
    expect(data.initial_view).toEqual({ ...CAPTURED_VIEW, hidden_layers: ['pericardium'] });
    expect(data.questions[0].view).toMatchObject({ camera: 'custom', alpha: 1.2, beta: 0.8, radius: 12 });
    expect(validateCase(data, MODEL).ok).toBe(true);
  });

  it('[T1-05] author submits a draft for review', async () => {
    const r = renderPortal('/portal/cases/heart_ms_01/edit', {
      as: AUTHOR,
      routes: [
        { path: '/api/cases/heart_ms_01', reply: record(SAMPLE) },
        { method: 'POST', path: '/api/cases/heart_ms_01/submit', reply: record(SAMPLE, { status: 'in_review' }) },
      ],
    });
    fireEvent.click(await screen.findByTestId('submit-review'));
    await waitFor(() => expect(r.api.find('POST', '/api/cases/heart_ms_01/submit')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('status-badge').textContent).toBe('In review'));
    expect(screen.queryByTestId('submit-review')).toBeNull();
  });

  it('[T1-04] preview as student renders CasePlayer in preview mode with keys stripped and labels off', async () => {
    const { answer: _a, ...q } = SAMPLE.questions[0];
    const r = renderPortal('/portal/cases/heart_ms_01/preview', {
      as: AUTHOR,
      routes: [{ path: '/api/cases/heart_ms_01/preview', reply: { ...SAMPLE, labels_visible: false, questions: [q] } }],
    });
    const player = await screen.findByTestId('case-player');
    expect(player.dataset.mode).toBe('preview');
    expect(player.dataset.case).toBe('heart_ms_01');
    expect(player.dataset.labels).toBe('false');
    expect(player.dataset.keysLeaked).toBe('false');
    expect(r.api.find('GET', '/api/cases/heart_ms_01/preview')).toHaveLength(1);
  });

  it('[T1-06] case list groups drafts / in review / published with version numbers; version history lists versions', async () => {
    renderPortal('/portal/cases', {
      as: AUTHOR,
      routes: [{ path: '/api/cases', reply: [
        record(SAMPLE),
        record({ ...SAMPLE, case_id: 'c_rev' }, { status: 'in_review', version: 2 }),
        record({ ...SAMPLE, case_id: 'c_pub' }, { status: 'published', version: 3 }),
      ] }],
    });
    expect(await within(await screen.findByTestId('cases-drafts')).findByText('heart_ms_01')).toBeInTheDocument();
    expect(within(screen.getByTestId('cases-review')).getByText('v2')).toBeInTheDocument();
    expect(within(screen.getByTestId('cases-published')).getByText('v3')).toBeInTheDocument();
    cleanup();
    renderPortal('/portal/cases/heart_ms_01/versions', {
      as: AUTHOR,
      routes: [{ path: '/api/cases/heart_ms_01/versions', reply: [record(SAMPLE, { version: 1, status: 'published' }), record(SAMPLE, { version: 2, status: 'draft' })] }],
    });
    const table = await screen.findByTestId('versions-table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1].textContent).toMatch(/v2/);
    expect(rows[2].textContent).toMatch(/v1/);
  });

  it('[T1-03] spreadsheet import posts multipart (file + course_id), links the template and lists row errors', async () => {
    const r = renderPortal('/portal/cases/import', {
      as: AUTHOR,
      routes: [{ method: 'POST', path: '/api/cases/import', reply: { created: [record(SAMPLE)], errors: [{ sheet: 'Questions', row: 4, case_id: 'x', message: 'unknown type' }] } }],
    });
    expect((await screen.findByTestId('template-link')).getAttribute('href')).toBe('/api/templates/case-template.xlsx');
    await waitFor(() => expect((screen.getByTestId('import-course') as HTMLSelectElement).value).toBe('c1'));
    const file = new File(['x'], 'cases.xlsx');
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('import-upload'));
    await screen.findByTestId('import-result');
    const body = r.api.find('POST', '/api/cases/import')[0].body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('course_id')).toBe('c1');
    expect((body.get('file') as File).name).toBe('cases.xlsx');
    expect(screen.getByText('unknown type')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { CaseRecord, CohortStats, ItemAnalysis, QuestionAnalytics, StructureHeat, StudentCourseResult, SuccessMetrics } from '@medsim/core';
import { renderPortal, user } from '../testUtils';
import { itemFlags } from './ReportsPage';

vi.mock('../../viewer/ModelViewer', async () => ({ ModelViewer: (await import('../testMocks')).MockModelViewer }));
vi.mock('../../viewer/ComparisonView', async () => ({ ComparisonView: (await import('../testMocks')).MockComparisonView }));
vi.mock('../../station/CasePlayer', async () => ({ CasePlayer: (await import('../testMocks')).MockCasePlayer }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ADMIN = user(['admin'], 'admin');
const CASE = {
  id: 'heart_01', course_id: 'c1', status: 'published', version: 1,
  data: { case_id: 'heart_01', course: 'ANAT2', model: 'heart_v1', variant: 'mitral_stenosis', stem: 'S', initial_view: { camera: 'anterior' }, questions: [
    { id: 'q1', type: 'identify', prompt: 'Select the mitral valve', answer: ['TA:mitral_valve'], points: 1 },
    { id: 'q2', type: 'mcq', prompt: 'Which murmur?', options: { A: 'a', B: 'b' }, answer: 'A', points: 1 },
  ] },
} as unknown as CaseRecord;
const STUDENTS: StudentCourseResult[] = [
  { student_id: 'st1', student_name: 'Student One', cohort_id: 'co1', cases: [{ case_id: 'heart_01', best_percent: 80, attempts: 2 }], course_percent: 80 },
  { student_id: 'st2', student_name: 'Student Two', cohort_id: 'co2', cases: [], course_percent: 0 },
];
const QA: QuestionAnalytics[] = [{ question_id: 'q1', attempts: 10, correct_rate: 0.6, avg_time_ms: 12500, common_wrong: [{ response: 'TA:left_ventricle', count: 3 }, { response: 'TA:right_atrium', count: 1 }] }];
const HEAT: StructureHeat[] = [
  { structure_id: 'TA:right_atrium', missed: 0, wrongly_selected: 1, total: 4 },
  { structure_id: 'TA:mitral_valve', missed: 4, wrongly_selected: 2, total: 10 },
];
const COH: CohortStats[] = [{ group: 'Class 2027', n: 30, mean_percent: 71.5, median_percent: 73, sd_percent: 9.2 }, { group: 'Class 2028', n: 28, mean_percent: 64.1, median_percent: 66, sd_percent: 11 }];
const ITEMS: ItemAnalysis[] = [
  { question_id: 'q1', difficulty: 0.55, discrimination: 0.45, point_biserial: 0.41, n: 40 },
  { question_id: 'q2', difficulty: 0.95, discrimination: 0.05, point_biserial: -0.1, n: 40 },
];
const METRICS: SuccessMetrics = { completion_without_help_rate: 0.86, fallback_usage_rate: 0.12, avg_time_to_publish_hours: 30.5, active_authors: 3, sessions: 7, sus_mean: 72.5, score_exam_correlation: 0.61 };

function routes() {
  return [
    { path: '/api/cases?course_id=c1', reply: [CASE] },
    { path: '/api/reports/students?course_id=c1', reply: STUDENTS },
    { path: '/api/reports/questions?case_id=heart_01', reply: QA },
    { path: /\/api\/reports\/heatmap/, reply: HEAT },
    { path: /\/api\/reports\/cohorts/, reply: COH },
    { path: '/api/reports/items?case_id=heart_01', reply: ITEMS },
    { path: '/api/reports/metrics?course_id=c1', reply: METRICS },
    { path: '/api/sus/summary', reply: { n: 12, mean: 72.5 } },
    { path: /\/api\/reports\/export\.(csv|pdf)/, reply: () => new Response('a,b\n1,2', { headers: { 'content-type': 'text/csv' } }) },
  ];
}
const tab = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }));

describe('reports', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('[T1-11] per-student results per case and per course', async () => {
    renderPortal('/portal/reports', { as: ADMIN, routes: routes() });
    const table = await screen.findByTestId('student-results');
    const rows = within(table).getAllByRole('row');
    expect(rows[0].textContent).toMatch(/heart_01/);
    expect(rows[1].textContent).toMatch(/Student One.*80%.*\(2\).*80%/);
    expect(rows[2].textContent).toMatch(/Student Two/);
  });

  it('[T1-12] per-question analytics: correct rate, average time, most common wrong answers', async () => {
    renderPortal('/portal/reports', { as: ADMIN, routes: routes() });
    await screen.findByTestId('student-results');
    tab(/Question analytics/);
    const table = await screen.findByTestId('question-analytics');
    const row = within(table).getAllByRole('row')[1];
    expect(row.textContent).toMatch(/Select the mitral valve/);
    expect(row.textContent).toMatch(/60%/);
    expect(row.textContent).toMatch(/12\.5 s/);
    expect(row.textContent).toMatch(/TA:left_ventricle \(3\)/);
  });

  it('[T1-13] export buttons download CSV and PDF from the right URLs', async () => {
    const r = renderPortal('/portal/reports', { as: ADMIN, routes: routes() });
    await screen.findByTestId('student-results');
    fireEvent.click(screen.getByTestId('export-csv'));
    fireEvent.click(screen.getByTestId('export-pdf'));
    await waitFor(() => expect(r.api.find('GET', /export/)).toHaveLength(2));
    expect(r.api.find('GET', /export/).map((c) => c.path)).toEqual(['/api/reports/export.csv?course_id=c1', '/api/reports/export.pdf?course_id=c1']);
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2));
  });

  it('[T2-02] structure heatmap: misidentification counts per structure, sorted, coloured, and highlighted on the model', async () => {
    const r = renderPortal('/portal/reports', { as: ADMIN, routes: routes() });
    await screen.findByTestId('student-results');
    tab(/Structure heatmap/);
    const table = await screen.findByTestId('heatmap-table');
    const rows = within(table).getAllByRole('row');
    expect(rows[1].textContent).toMatch(/Mitral valve.*4.*2.*6.*10/);
    expect(rows[2].textContent).toMatch(/Right atrium/);
    expect(r.api.find('GET', '/api/reports/heatmap?course_id=c1')).toHaveLength(1);
    fireEvent.click(screen.getByText('Show on 3D model'));
    expect((await screen.findByTestId('heatmap-viewer')).dataset.selected).toBe('TA:mitral_valve,TA:right_atrium');
    fireEvent.change(screen.getByTestId('report-case'), { target: { value: 'heart_01' } });
    await waitFor(() => expect(r.api.find('GET', '/api/reports/heatmap?case_id=heart_01')).toHaveLength(1));
  });

  it('[T2-03] cohort comparison by cohort and by year with an SVG bar chart', async () => {
    const r = renderPortal('/portal/reports', { as: ADMIN, routes: routes() });
    await screen.findByTestId('student-results');
    tab(/Cohort comparison/);
    const chart = await screen.findByTestId('bar-chart');
    expect(within(chart).getAllByTestId('bar')).toHaveLength(2);
    expect(chart.textContent).toMatch(/Class 2027/);
    expect(chart.textContent).toMatch(/71\.5%/);
    fireEvent.change(screen.getByTestId('cohort-by'), { target: { value: 'year' } });
    await waitFor(() => expect(r.api.find('GET', '/api/reports/cohorts?course_id=c1&by=year')).toHaveLength(1));
    expect(r.api.find('GET', '/api/reports/cohorts?course_id=c1&by=cohort')).toHaveLength(1);
  });

  it('[T2-04] item analysis table shows difficulty, discrimination, point-biserial and flags poor items', async () => {
    renderPortal('/portal/reports', { as: ADMIN, routes: routes() });
    await screen.findByTestId('student-results');
    tab(/Item analysis/);
    await screen.findByTestId('item-analysis');
    expect(screen.getByTestId('item-q1')).toHaveAttribute('data-flagged', 'false');
    expect(screen.getByTestId('item-q1').textContent).toMatch(/0\.55.*0\.45.*0\.41/);
    const q2 = screen.getByTestId('item-q2');
    expect(q2).toHaveAttribute('data-flagged', 'true');
    expect(q2.textContent).toMatch(/Very easy/);
    expect(q2.textContent).toMatch(/Poor discrimination/);
    expect(q2.textContent).toMatch(/Negative point-biserial/);
    expect(itemFlags({ question_id: 'x', difficulty: 0.1, discrimination: null, point_biserial: null, n: 3 })).toEqual(['too_hard']);
  });

  it('[T3-03] success-metrics dashboard: completion without help, fallback usage, time-to-publish, SUS, score↔exam correlation', async () => {
    const r = renderPortal('/portal/reports', { as: ADMIN, routes: [...routes(), { method: 'POST', path: '/api/exam-scores', reply: {} }] });
    await screen.findByTestId('student-results');
    tab(/Success metrics/);
    expect((await screen.findByTestId('metric-completion')).textContent).toMatch(/86%/);
    expect(screen.getByTestId('metric-fallback').textContent).toMatch(/12%/);
    expect(screen.getByTestId('metric-publish').textContent).toMatch(/30\.5 h/);
    expect(screen.getByTestId('metric-authors').textContent).toMatch(/3/);
    expect(screen.getByTestId('metric-sessions').textContent).toMatch(/7/);
    await waitFor(() => expect(screen.getByTestId('metric-sus').textContent).toMatch(/72\.5 \(n=12\)/));
    expect(screen.getByTestId('metric-corr').textContent).toMatch(/0\.61/);
    fireEvent.change(screen.getByTestId('exam-csv'), { target: { value: 'student1,72\nstudent2;85\nbad line' } });
    fireEvent.click(screen.getByText('Upload'));
    await waitFor(() => expect(r.api.find('POST', '/api/exam-scores')).toHaveLength(1));
    expect(r.api.find('POST', '/api/exam-scores')[0].body).toEqual({ rows: [
      { student_id: 'student1', course_id: 'c1', percent: 72 },
      { student_id: 'student2', course_id: 'c1', percent: 85 },
    ] });
  });

  it('[T2-08] manual grading queue shows free-text answers and POSTs points', async () => {
    const r = renderPortal('/portal/grading', {
      as: user(['author'], 'author1'),
      routes: [
        { path: '/api/grading/pending', reply: [{ attempt_id: 'a1', question_id: 'q5', prompt: { en: 'Describe the murmur', ar: 'صف النفخة' }, response: 'Mid-diastolic rumble', student_id: 'student1' }] },
        { method: 'POST', path: '/api/grading/a1/q5', reply: { id: 'a1', student_id: 'student1', case_id: 'c', case_version: 1, score: 4, max_score: 5, percent: 80, pending_manual: 0, submitted_at: '' } },
      ],
    });
    expect(await screen.findByText('Mid-diastolic rumble')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('points-a1-q5'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('grade-a1-q5'));
    await waitFor(() => expect(r.api.find('POST', '/api/grading/a1/q5')).toHaveLength(1));
    expect(r.api.find('POST', '/api/grading/a1/q5')[0].body).toEqual({ points: 2 });
    expect(await screen.findByTestId('graded')).toHaveTextContent('4 / 5 (80%)');
    expect(screen.queryByTestId('grading-queue')).toBeNull();
  });
});

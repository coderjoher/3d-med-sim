import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { CaseData, CaseRecord } from '@medsim/core';
import { renderPortal, user, MODEL } from '../testUtils';

vi.mock('../../viewer/ModelViewer', async () => ({ ModelViewer: (await import('../testMocks')).MockModelViewer }));
vi.mock('../../viewer/ComparisonView', async () => ({ ComparisonView: (await import('../testMocks')).MockComparisonView }));
vi.mock('../../station/CasePlayer', async () => ({ CasePlayer: (await import('../testMocks')).MockCasePlayer }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const REVIEWER = user(['reviewer'], 'reviewer1');
const DATA: CaseData = {
  case_id: 'heart_ms_01', course: 'ANAT2', model: 'heart_v1', variant: 'mitral_stenosis', stem: 'Stem',
  initial_view: { camera: 'anterior' },
  questions: [{ id: 'q1', type: 'mcq', prompt: 'Which?', options: { A: 'Aortic', B: 'Mitral' }, answer: 'B', points: 1 }],
};
const rec = (extra: Partial<CaseRecord> = {}): CaseRecord => ({ id: 'heart_ms_01', org_id: 'demo', course_id: 'c1', version: 1, status: 'in_review', author_id: 'author1', data: DATA, model_version: 2, created_at: '', updated_at: '', ...extra });
const { answer: _a, ...playerQ } = DATA.questions[0];
const PREVIEW = { ...DATA, labels_visible: false, questions: [playerQ] };

function reviewRoutes() {
  return [
    { path: '/api/cases', reply: [rec()] },
    { path: '/api/cases/heart_ms_01', reply: rec() },
    { path: '/api/cases/heart_ms_01/preview', reply: PREVIEW },
    { method: 'POST', path: '/api/cases/heart_ms_01/approve', reply: rec({ status: 'published', reviewer_id: 'reviewer1' }) },
    { method: 'POST', path: '/api/cases/heart_ms_01/reject', reply: rec({ status: 'draft', review_comment: 'Fix q1' }) },
  ];
}

describe('reviewer workflow', () => {
  it('[T1-05] review queue lists in_review cases and opens a side-by-side review (keys + student preview)', async () => {
    const r = renderPortal('/portal/review', { as: REVIEWER, routes: reviewRoutes() });
    expect(await screen.findByTestId('review-row-heart_ms_01')).toBeInTheDocument();
    expect(r.api.find('GET', '/api/cases?status=in_review')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('review-open-heart_ms_01'));
    const summary = await screen.findByTestId('case-summary');
    expect(within(summary).getByText(/✔/).textContent).toMatch(/B/);
    expect((await screen.findByTestId('case-player')).dataset.mode).toBe('preview');
  });

  it('[T1-05] approve calls POST /approve with the comment and shows published', async () => {
    const r = renderPortal('/portal/review/heart_ms_01', { as: REVIEWER, routes: reviewRoutes() });
    fireEvent.change(await screen.findByTestId('review-comment-input'), { target: { value: 'Accurate' } });
    fireEvent.click(screen.getByTestId('approve'));
    await waitFor(() => expect(r.api.find('POST', '/api/cases/heart_ms_01/approve')).toHaveLength(1));
    expect(r.api.find('POST', '/api/cases/heart_ms_01/approve')[0].body).toEqual({ comment: 'Accurate' });
    await waitFor(() => expect(screen.getByTestId('status-badge').textContent).toBe('Published'));
  });

  it('[T1-05] reject requires a comment, then calls POST /reject (case returns to draft)', async () => {
    const r = renderPortal('/portal/review/heart_ms_01', { as: REVIEWER, routes: reviewRoutes() });
    fireEvent.click(await screen.findByTestId('reject'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/explain/);
    expect(r.api.find('POST', '/api/cases/heart_ms_01/reject')).toHaveLength(0);
    fireEvent.change(screen.getByTestId('review-comment-input'), { target: { value: 'Fix q1' } });
    fireEvent.click(screen.getByTestId('reject'));
    await waitFor(() => expect(r.api.find('POST', '/api/cases/heart_ms_01/reject')).toHaveLength(1));
    expect(r.api.find('POST', '/api/cases/heart_ms_01/reject')[0].body).toEqual({ comment: 'Fix q1' });
    await waitFor(() => expect(screen.getByTestId('status-badge').textContent).toBe('Draft'));
  });

  it('[T1-05] a reviewer cannot approve their own case (reviewer must differ from author)', async () => {
    renderPortal('/portal/review/heart_ms_01', { as: user(['author', 'reviewer'], 'author1'), routes: reviewRoutes() });
    expect(await screen.findByTestId('own-case-warning')).toBeInTheDocument();
    expect(screen.getByTestId('approve')).toBeDisabled();
  });

  it('[T1-20] model sign-off shows status and POSTs /models/:id/sign-off with notes', async () => {
    let signed = false;
    const r = renderPortal('/portal/models', {
      as: REVIEWER,
      routes: [
        { path: '/api/models', reply: () => [{ ...MODEL, sign_off: signed ? { reviewer: 'reviewer1', date: '2026-10-08T00:00:00Z', notes: 'ok' } : undefined }] },
        { method: 'POST', path: '/api/models/heart_v1/sign-off', reply: () => { signed = true; return {}; } },
      ],
    });
    expect(await screen.findByText('Not signed off')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Notes'), { target: { value: 'ok' } });
    fireEvent.click(screen.getByTestId('sign-heart_v1'));
    await waitFor(() => expect(screen.getByTestId('signoff-heart_v1').textContent).toMatch(/Signed off by reviewer1 on 2026-10-08/));
    expect(r.api.find('POST', '/api/models/heart_v1/sign-off')[0].body).toEqual({ notes: 'ok' });
  });

  it('[T2-07] comparison page shows normal vs pathological variant side by side', async () => {
    renderPortal('/portal/compare', { as: REVIEWER });
    const cv = await screen.findByTestId('comparison-view');
    expect(cv.dataset.model).toBe('heart_v1');
    expect(cv.dataset.variant).toBe('mitral_stenosis');
  });
});

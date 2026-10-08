import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BUILTIN_CASES, applyFeedbackLevel, scoreCase, summarizeLog, toPlayerCase, type CaseData, type InteractionLog, type AnswerRecord } from '@medsim/core';
import type { ModelViewerProps } from '../viewer/ModelViewer';
import { PrefsProvider } from '../shared/prefs';
import { CasePlayer, type CasePlayerProps } from './CasePlayer';

const viewer: { props: ModelViewerProps | null } = { props: null };
vi.mock('../viewer/ModelViewer', () => ({
  ModelViewer: (p: ModelViewerProps) => {
    viewer.props = p;
    return <div data-testid="mock-viewer" data-labels={p.labelsVisible ? 'on' : 'off'} data-selected={(p.selectedIds ?? []).join(' ')} />;
  },
}));

const CASE: CaseData = {
  case_id: 'T-1', course: 'Test', topic: 'Test case', model: 'heart_v1', variant: 'mitral_stenosis',
  stem: 'A 45-year-old woman with dyspnoea.', initial_view: { camera: 'anterior', hidden_layers: ['pericardium'] },
  labels_visible: true, feedback_level: 'score',
  questions: [
    { id: 'q1', type: 'identify', prompt: 'Select the affected valve.', answer: ['TA:mitral_valve'], points: 2 },
    { id: 'q2', type: 'mcq', prompt: 'Most likely etiology?', options: { a: 'Congenital', b: 'Rheumatic' }, answer: 'b', points: 1 },
  ],
};

function renderPlayer(p: Partial<CasePlayerProps> & { full?: CaseData } = {}) {
  const full = p.full ?? CASE;
  const onSubmit = vi.fn(async (answers: AnswerRecord[], _log: InteractionLog, _timedOut: boolean) => applyFeedbackLevel(scoreCase(full, answers), full.feedback_level ?? 'score'));
  render(<PrefsProvider><CasePlayer playerCase={toPlayerCase(full)} mode="assessment" onSubmit={onSubmit} {...p} /></PrefsProvider>);
  return { onSubmit };
}

const select = (id: string | null) => act(() => { viewer.props!.onSelect!(id); });

beforeEach(() => { viewer.props = null; localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('CasePlayer', () => {
  it('[T0-05] labels are forced off in assessment mode even if the case requests them', () => {
    renderPlayer();
    expect(viewer.props!.labelsVisible).toBe(false);
    const btn = screen.getByTestId('labels-toggle');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(viewer.props!.labelsVisible).toBe(false);
    expect(screen.getByTestId('labels-disabled')).toHaveTextContent('Labels are disabled during assessment');
  });

  it('[T0-05] labels toggle in practice mode', () => {
    renderPlayer({ mode: 'practice', playerCase: { ...toPlayerCase(CASE), labels_visible: true } });
    expect(viewer.props!.labelsVisible).toBe(true);
    fireEvent.click(screen.getByTestId('labels-toggle'));
    expect(viewer.props!.labelsVisible).toBe(false);
  });

  it('[T0-13] no answer is recorded without the explicit confirmation step', async () => {
    const { onSubmit } = renderPlayer();
    select('TA:mitral_valve');
    expect(screen.getByTestId('identify-selection')).toHaveTextContent('Mitral valve');
    expect(viewer.props!.selectedIds).toEqual(['TA:mitral_valve']);
    // open confirm, then cancel -> nothing recorded
    fireEvent.click(screen.getByTestId('confirm-answer'));
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-no'));
    expect(screen.queryByTestId('recorded')).toBeNull();
    // MCQ choice without confirmation
    fireEvent.click(screen.getByTestId('next'));
    fireEvent.click(screen.getByTestId('option-b'));
    fireEvent.click(screen.getByTestId('submit-case'));
    expect(screen.getByTestId('unanswered-warning')).toHaveTextContent('2 question(s) not answered');
    fireEvent.click(screen.getByTestId('submit-yes'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual([]);
    const log = onSubmit.mock.calls[0][1];
    expect(log.events.some((e) => e.type === 'answer-cancelled')).toBe(true);
    expect(log.events.some((e) => e.type === 'answer-confirmed')).toBe(false);
  });

  it('[T0-13] a confirmed answer is recorded with a confirmation timestamp', async () => {
    const { onSubmit } = renderPlayer();
    select('TA:mitral_valve');
    fireEvent.click(screen.getByTestId('confirm-answer'));
    fireEvent.click(screen.getByTestId('confirm-yes'));
    expect(screen.getByTestId('recorded')).toHaveTextContent('Mitral valve');
    fireEvent.click(screen.getByTestId('submit-case'));
    fireEvent.click(screen.getByTestId('submit-yes'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const answers = onSubmit.mock.calls[0][0];
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ question_id: 'q1', value: ['TA:mitral_valve'] });
    expect(typeof answers[0].confirmed_at).toBe('number');
  });

  it('[T0-19] next/previous navigation and the countdown auto-submits at zero', async () => {
    const { onSubmit } = renderPlayer({ playerCase: { ...toPlayerCase(CASE), time_limit_min: 0.02 } });
    expect(screen.getByTestId('timer')).toHaveTextContent(/00:0[12]/);
    expect(screen.getByTestId('prev')).toBeDisabled();
    fireEvent.click(screen.getByTestId('next'));
    expect(screen.getByTestId('prompt')).toHaveTextContent('Most likely etiology?');
    expect(screen.getByTestId('next')).toBeDisabled();
    fireEvent.click(screen.getByTestId('prev'));
    expect(screen.getByTestId('prompt')).toHaveTextContent('Select the affected valve.');
    fireEvent.click(screen.getByTestId('qnav-2'));
    fireEvent.click(screen.getByTestId('option-b'));
    fireEvent.click(screen.getByTestId('confirm-answer'));
    fireEvent.click(screen.getByTestId('confirm-yes'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled(), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][2]).toBe(true); // timedOut
    expect(onSubmit.mock.calls[0][0]).toHaveLength(1); // confirmed answers are kept
    expect(onSubmit.mock.calls[0][1].events.some((e) => e.type === 'timeout')).toBe(true);
    expect(await screen.findByTestId('timed-out')).toBeInTheDocument();
  });

  it('[T0-20] score-only feedback is shown on the summary screen after submit', async () => {
    renderPlayer();
    select('TA:mitral_valve');
    fireEvent.click(screen.getByTestId('confirm-answer'));
    fireEvent.click(screen.getByTestId('confirm-yes'));
    fireEvent.click(screen.getByTestId('submit-case'));
    fireEvent.click(screen.getByTestId('submit-yes'));
    expect(await screen.findByTestId('score')).toHaveTextContent('Your score: 2 / 3 (67%)');
    expect(screen.queryByText('Correct answer', { exact: false })).toBeNull();
  });

  it('[T1-15] full feedback lists correct answers; none hides the score', async () => {
    const full = { ...CASE, feedback_level: 'full' as const, questions: CASE.questions.map((q) => ({ ...q, feedback: `Because ${q.id}` })) };
    renderPlayer({ full });
    fireEvent.click(screen.getByTestId('submit-case'));
    fireEvent.click(screen.getByTestId('submit-yes'));
    expect(await screen.findByTestId('summary-q1')).toHaveTextContent('Correct answer: Mitral valve');
    expect(screen.getByTestId('summary-q2')).toHaveTextContent('Because q2');
    cleanup();
    renderPlayer({ onSubmit: async () => ({}) });
    fireEvent.click(screen.getByTestId('submit-case'));
    fireEvent.click(screen.getByTestId('submit-yes'));
    expect(await screen.findByTestId('score-hidden')).toBeInTheDocument();
  });

  it('[T0-21] interaction log records answers, time per question, structures viewed and layer toggles', async () => {
    const { onSubmit } = renderPlayer({ attemptId: 'A-1', studentId: 'S1', stationId: 'ST-1' });
    act(() => { viewer.props!.onHover!('TA:left_atrium'); });
    await new Promise((r) => setTimeout(r, 400));
    select('TA:mitral_valve');
    fireEvent.click(screen.getByTestId('confirm-answer'));
    fireEvent.click(screen.getByTestId('confirm-yes'));
    fireEvent.click(screen.getByTestId('layer-valves'));
    fireEvent.click(screen.getByTestId('next'));
    fireEvent.click(screen.getByTestId('submit-case'));
    fireEvent.click(screen.getByTestId('submit-yes'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const log = onSubmit.mock.calls[0][1];
    expect(log).toMatchObject({ attempt_id: 'A-1', case_id: 'T-1', student_id: 'S1', station_id: 'ST-1' });
    const types = log.events.map((e) => e.type);
    for (const t of ['case-open', 'question-open', 'question-close', 'structure-view', 'structure-select', 'answer-staged', 'answer-confirmed', 'layer-toggle', 'submit']) expect(types).toContain(t);
    const sum = summarizeLog(log);
    expect(Object.keys(sum.time_per_question_ms).sort()).toEqual(['q1', 'q2']);
    expect(sum.structures_viewed).toEqual(expect.arrayContaining(['TA:left_atrium', 'TA:mitral_valve']));
    expect(log.ended_at).toBeGreaterThanOrEqual(log.started_at);
  });

  it('[T1-14] multi-select and ordering inputs stage values that need confirmation', async () => {
    const full: CaseData = { ...CASE, questions: [
      { id: 'm', type: 'multi', prompt: 'Pick', options: { a: 'A', b: 'B', c: 'C' }, answer: ['a', 'c'], points: 2 },
      { id: 'o', type: 'order', prompt: 'Order', options: { x: 'X', y: 'Y', z: 'Z' }, answer: ['z', 'y', 'x'], points: 1 },
    ] };
    const { onSubmit } = renderPlayer({ full });
    fireEvent.click(screen.getByTestId('option-a'));
    fireEvent.click(screen.getByTestId('option-c'));
    fireEvent.click(screen.getByTestId('confirm-answer'));
    fireEvent.click(screen.getByTestId('confirm-yes'));
    fireEvent.click(screen.getByTestId('next'));
    fireEvent.click(screen.getByTestId('down-x'));
    fireEvent.click(screen.getByTestId('down-x'));
    fireEvent.click(screen.getByTestId('up-z'));
    fireEvent.click(screen.getByTestId('confirm-answer'));
    expect(screen.getByTestId('confirm-value')).toHaveTextContent('z. Z → y. Y → x. X');
    fireEvent.click(screen.getByTestId('confirm-yes'));
    fireEvent.click(screen.getByTestId('submit-case'));
    fireEvent.click(screen.getByTestId('submit-yes'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].map((a) => a.value)).toEqual([['a', 'c'], ['z', 'y', 'x']]);
  });

  it('[T1-04] preview mode shows the case like a student (no keys, labels off) and records nothing', async () => {
    const pc = toPlayerCase(BUILTIN_CASES[0]);
    render(<PrefsProvider><CasePlayer playerCase={pc} mode="preview" /></PrefsProvider>);
    expect(viewer.props!.labelsVisible).toBe(false);
    expect(JSON.stringify(pc)).not.toContain('"answer"');
    fireEvent.click(screen.getByTestId('submit-case'));
    fireEvent.click(screen.getByTestId('submit-yes'));
    expect(await screen.findByText(/nothing is recorded/)).toBeInTheDocument();
    expect(Object.keys(localStorage).filter((k) => k !== 'medsim.prefs')).toEqual([]);
  });
});

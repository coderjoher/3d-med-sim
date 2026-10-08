import type { AnswerRecord, CaseData, InteractionLog } from '@medsim/core';

/** A valid heart case authored through the API (A-02). */
export function sampleCase(case_id: string, over: Partial<CaseData> = {}): CaseData {
  return {
    case_id,
    course: 'Anatomy II - Thorax',
    topic: 'Mitral stenosis',
    model: 'heart_v1',
    variant: 'mitral_stenosis',
    stem: { en: 'A 45-year-old woman with exertional dyspnoea.', ar: 'امرأة تبلغ 45 عاماً تعاني من ضيق نفس جهدي.' },
    initial_view: { camera: 'anterior', hidden_layers: ['pericardium'] },
    labels_visible: false,
    time_limit_min: 10,
    feedback_level: 'full',
    questions: [
      { id: 'q1', type: 'identify', prompt: 'Select the affected valve.', answer: ['TA:mitral_valve'], points: 2, feedback: 'The mitral valve.' },
      {
        id: 'q2', type: 'mcq', prompt: 'Most common cause?', options: { a: 'Congenital', b: 'Rheumatic fever', c: 'Infection' }, answer: 'b', points: 1,
        feedback: 'Rheumatic heart disease.',
      },
    ],
    ...over,
  };
}

export const ans = (question_id: string, value: string | string[]): AnswerRecord => ({ question_id, value, confirmed_at: Date.now() });

export function logFor(case_id: string, extra: Partial<InteractionLog> = {}): InteractionLog {
  const t = Date.now() - 60_000;
  return {
    attempt_id: 'local', case_id, started_at: t, ended_at: t + 50_000,
    events: [
      { t, type: 'case-open' },
      { t: t + 1000, type: 'question-open', question_id: 'q1' },
      { t: t + 9000, type: 'question-close', question_id: 'q1' },
      { t: t + 9000, type: 'question-open', question_id: 'q2' },
      { t: t + 15000, type: 'question-close', question_id: 'q2' },
      { t: t + 50_000, type: 'submit' },
    ],
    ...extra,
  };
}

/** Answers for built-in CARD-010 (all correct unless overridden). */
export function card010Answers(over: Record<string, string | string[]> = {}): AnswerRecord[] {
  const base: Record<string, string | string[]> = { q1: ['TA:right_ventricle'], q2: ['TA:superior_vena_cava'], q3: 'b', q4: ['TA:pulmonary_trunk'], ...over };
  return Object.entries(base).map(([q, v]) => ans(q, v));
}

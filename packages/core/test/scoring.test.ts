import { describe, expect, it } from 'vitest';
import { applyFeedbackLevel, applyManualGrade, scoreCase, scoreQuestion } from '../src/scoring.js';
import { HEART_CASES, KIDNEY_CASES } from '../src/content/index.js';
import type { CaseQuestion } from '../src/types.js';

const card12 = HEART_CASES.find((c) => c.case_id === 'CARD-012')!;
const multi: CaseQuestion = { id: 'm', type: 'multi', prompt: 'x', options: { a: 'A', b: 'B', c: 'C', d: 'D' }, answer: ['a', 'b', 'c'], points: 3 };

describe('scoring', () => {
  it('[T0-18] identify question scored by structure id', () => {
    const q = card12.questions[0];
    expect(scoreQuestion(q, ['TA:mitral_valve'])).toMatchObject({ correct: true, points_awarded: 2, points_possible: 2 });
    expect(scoreQuestion(q, 'TA:mitral_valve').correct).toBe(true);
    expect(scoreQuestion(q, ['TA:aortic_valve'])).toMatchObject({ correct: false, points_awarded: 0 });
    expect(scoreQuestion(q, undefined)).toMatchObject({ correct: false, points_awarded: 0, pending_manual: false });
    const any: CaseQuestion = { id: 'i', type: 'identify', prompt: 'x', answer: ['TA:a', 'TA:b'], points: 1 };
    expect(scoreQuestion(any, ['TA:b']).correct).toBe(true);
    const all: CaseQuestion = { ...any, match: 'all' };
    expect(scoreQuestion(all, ['TA:b']).correct).toBe(false);
    expect(scoreQuestion(all, ['TA:b', 'TA:a']).correct).toBe(true);
  });

  it('[T0-18] MCQ scored by option key', () => {
    const q = card12.questions[1];
    expect(scoreQuestion(q, 'b')).toMatchObject({ correct: true, points_awarded: 1 });
    expect(scoreQuestion(q, ['b']).correct).toBe(true);
    expect(scoreQuestion(q, 'a').correct).toBe(false);
    expect(scoreQuestion({ ...q, answer: ['b'] }, 'b').correct).toBe(true);
  });

  it('[T0-18] scoreCase totals, unanswered = 0, last confirmed answer wins', () => {
    const r = scoreCase(card12, [
      { question_id: 'q1', value: ['TA:aortic_valve'], confirmed_at: 100 },
      { question_id: 'q1', value: ['TA:mitral_valve'], confirmed_at: 200 },
    ]);
    expect(r.score).toBe(2);
    expect(r.max_score).toBe(3);
    expect(r.percent).toBe(66.67);
    expect(r.questions[1]).toMatchObject({ points_awarded: 0, correct: false });
    const r2 = scoreCase(card12, [
      { question_id: 'q1', value: ['TA:mitral_valve'], confirmed_at: 300 },
      { question_id: 'q1', value: ['TA:aortic_valve'], confirmed_at: 250 },
      { question_id: 'q2', value: 'b', confirmed_at: 400 },
    ]);
    expect(r2.score).toBe(3);
    expect(r2.percent).toBe(100);
  });

  it('[T1-14] multi-select: all-or-nothing by default, configurable partial credit', () => {
    expect(scoreQuestion(multi, ['a', 'b', 'c'])).toMatchObject({ correct: true, points_awarded: 3 });
    expect(scoreQuestion(multi, ['c', 'a', 'b']).correct).toBe(true);
    expect(scoreQuestion(multi, ['a', 'b']).points_awarded).toBe(0);
    const pc = { ...multi, partial_credit: true };
    expect(scoreQuestion(pc, ['a', 'b'])).toMatchObject({ points_awarded: 2, correct: false });
    expect(scoreQuestion(pc, ['a', 'b', 'd']).points_awarded).toBe(1); // (2-1)/3*3
    expect(scoreQuestion(pc, ['a', 'd']).points_awarded).toBe(0);
    expect(scoreQuestion({ ...pc, points: 1 }, ['a']).points_awarded).toBe(0.33); // rounded to 2 dp
  });

  it('[T1-14] ordering questions require the exact sequence', () => {
    const q = KIDNEY_CASES[0].questions.find((x) => x.type === 'order')!;
    expect(scoreQuestion(q, ['c', 'b', 'd', 'a'])).toMatchObject({ correct: true, points_awarded: 2 });
    expect(scoreQuestion(q, ['b', 'c', 'd', 'a'])).toMatchObject({ correct: false, points_awarded: 0 });
    expect(scoreQuestion(q, ['c', 'b', 'd']).correct).toBe(false);
  });

  it('[T0-20] score-only feedback returns totals without per-question answers', () => {
    const r = scoreCase(card12, [{ question_id: 'q1', value: ['TA:mitral_valve'], confirmed_at: 1 }]);
    const s = applyFeedbackLevel(r, 'score');
    expect(s).toEqual({ score: 2, max_score: 3, percent: 66.67, pending_manual: 0 });
    expect(s.questions).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('mitral');
  });

  it('[T1-15] feedback level none hides the score; full includes correct answers and feedback', () => {
    const r = scoreCase(card12, [{ question_id: 'q2', value: 'a', confirmed_at: 1 }]);
    expect(applyFeedbackLevel(r, 'none')).toEqual({});
    const f = applyFeedbackLevel(r, 'full');
    expect(f.score).toBe(0);
    expect(f.questions![0].correct_answer).toEqual(['TA:mitral_valve']);
    expect(f.questions![1]).toMatchObject({ correct_answer: 'b', response: 'a', correct: false });
    expect(f.questions![1].feedback).toEqual(card12.questions[1].feedback);
  });

  it('[T2-08] free-text answers are stored pending; manual grading updates the score', () => {
    const c = KIDNEY_CASES[1];
    const r = scoreCase(c, [
      { question_id: 'q1', value: ['TA:renal_pelvis'], confirmed_at: 1 },
      { question_id: 'q3', value: 'Back-pressure causes atrophy', confirmed_at: 2 },
    ]);
    const tq = r.questions.find((q) => q.question_id === 'q3')!;
    expect(tq).toMatchObject({ pending_manual: true, points_awarded: 0, points_possible: 3 });
    expect(r.pending_manual).toBe(1);
    expect(r.score).toBe(1);
    const g = applyManualGrade(r, 'q3', 2.5);
    expect(g.score).toBe(3.5);
    expect(g.pending_manual).toBe(0);
    expect(g.percent).toBe(70);
    expect(g.questions.find((q) => q.question_id === 'q3')).toMatchObject({ pending_manual: false, points_awarded: 2.5 });
    expect(r.score).toBe(1); // original untouched
    expect(() => applyManualGrade(r, 'q3', 4)).toThrow();
    expect(() => applyManualGrade(r, 'q1', 1)).toThrow();
    expect(() => applyManualGrade(r, 'nope', 1)).toThrow();
  });
});

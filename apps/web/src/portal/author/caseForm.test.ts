import { describe, it, expect } from 'vitest';
import { validateCase, type CaseData } from '@medsim/core';
import { caseToForm, emptyForm, formToCase, newQuestion, nextOptionKey, toggleTarget } from './caseForm';
import { MODEL } from '../testUtils';

const FULL: CaseData = {
  case_id: 'heart_ms_01', course: 'ANAT2', topic: 'Valves', model: 'heart_v1', variant: 'mitral_stenosis',
  stem: { en: 'Stem', ar: 'نص' },
  initial_view: { camera: 'custom', alpha: 1, beta: 0.5, radius: 10, hidden_layers: ['pericardium'] },
  labels_visible: false, time_limit_min: 12, allowed_layers: ['chambers'], feedback_level: 'full',
  questions: [
    { id: 'q1', type: 'identify', prompt: 'Select', answer: ['TA:mitral_valve', 'TA:left_ventricle'], match: 'all', points: 2, view: { camera: 'left' } },
    { id: 'q2', type: 'mcq', prompt: { en: 'Which?', ar: 'أي؟' }, options: { A: 'a', B: { en: 'b', ar: 'ب' } }, answer: 'B', points: 1, feedback: { en: 'Because', ar: 'لأن' } },
    { id: 'q3', type: 'multi', prompt: 'All', options: { A: 'a', B: 'b', C: 'c' }, answer: ['A', 'C'], partial_credit: true, points: 3 },
    { id: 'q4', type: 'order', prompt: 'Order', options: { A: 'a', B: 'b', C: 'c' }, answer: ['C', 'A', 'B'], points: 2 },
    { id: 'q5', type: 'text', prompt: 'Explain', answer: 'model answer', points: 5 },
  ],
  meta: { objectives: ['One', 'Two'], difficulty: 'hard' },
};

describe('case form conversion', () => {
  it('[T1-03] caseToForm → formToCase round-trips a full case (all question types, bilingual fields)', () => {
    const out = formToCase(caseToForm(FULL, 'c1'));
    expect(out).toEqual(FULL);
    expect(validateCase(out, MODEL).ok).toBe(true);
  });

  it('[T1-14] multi keeps partial_credit flag; order keeps key sequence; mcq answer is a single key', () => {
    const f = emptyForm(MODEL, { id: 'c1', code: 'ANAT2' });
    f.case_id = 'x'; f.stem.en = 'S';
    f.questions = [
      { ...newQuestion(0, 'multi'), prompt: { en: 'p', ar: '' }, options: [{ key: 'A', en: 'a', ar: '' }, { key: 'B', en: 'b', ar: '' }], answer: ['B'], partial_credit: true },
      { ...newQuestion(1, 'order'), prompt: { en: 'p', ar: '' }, options: [{ key: 'A', en: 'a', ar: '' }, { key: 'B', en: 'b', ar: '' }], answer: ['B', 'A'] },
      { ...newQuestion(2, 'mcq'), prompt: { en: 'p', ar: '' }, options: [{ key: 'A', en: 'a', ar: '' }, { key: 'B', en: 'b', ar: '' }], answer: ['A'] },
    ];
    const c = formToCase(f);
    expect(c.questions[0]).toMatchObject({ partial_credit: true, answer: ['B'] });
    expect(c.questions[1]).toMatchObject({ answer: ['B', 'A'] });
    expect(c.questions[1].partial_credit).toBeUndefined();
    expect(c.questions[2].answer).toBe('A');
    expect(validateCase(c, MODEL).ok).toBe(true);
  });

  it('[T2-01] toggleTarget adds and removes identify answer structures', () => {
    let q = newQuestion(0, 'identify');
    q = toggleTarget(q, 'TA:mitral_valve');
    q = toggleTarget(q, 'TA:left_ventricle');
    expect(q.answer).toEqual(['TA:mitral_valve', 'TA:left_ventricle']);
    q = toggleTarget(q, 'TA:mitral_valve');
    expect(q.answer).toEqual(['TA:left_ventricle']);
    expect(nextOptionKey([{ key: 'A', en: '', ar: '' }, { key: 'C', en: '', ar: '' }])).toBe('B');
  });
});

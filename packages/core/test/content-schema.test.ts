import { describe, expect, it } from 'vitest';
import { BUILTIN_CASES, HEART_CASES, KIDNEY_CASES, MODELS, PRACTICE_CASE, getModel } from '../src/content/index.js';
import { toPlayerCase, validateCase } from '../src/schema.js';
import type { CaseData } from '../src/types.js';

const PRD_EXAMPLE = {
  case_id: 'CARD-012',
  course: 'Anatomy II - Thorax',
  model: 'heart_v1',
  variant: 'mitral_stenosis',
  stem: 'A 45-year-old woman presents with exertional dyspnea and a history of rheumatic fever.',
  initial_view: { camera: 'anterior', hidden_layers: ['pericardium'] },
  labels_visible: false,
  time_limit_min: 10,
  questions: [
    { id: 'q1', type: 'identify', prompt: 'Select the affected valve.', answer: ['TA:mitral_valve'], points: 2 },
    { id: 'q2', type: 'mcq', prompt: 'What is the most likely etiology?', options: { a: 'Congenital', b: 'Rheumatic', c: 'Infective', d: 'Degenerative' }, answer: 'b', points: 1 },
  ],
  meta: { author: '...', reviewer: '...', version: 3, status: 'published' },
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const heart = getModel('heart_v1')!;

describe('models', () => {
  it('[T0-01] heart model: every structure has a stable TA: id and an existing layer', () => {
    expect(heart).toBeDefined();
    expect(heart.structures.length).toBeGreaterThanOrEqual(15);
    const layers = new Set(heart.layers.map((l) => l.id));
    for (const l of ['pericardium', 'myocardium', 'chambers', 'valves', 'vessels', 'coronary']) expect(layers.has(l)).toBe(true);
    const ids = heart.structures.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of heart.structures) {
      expect(s.id).toMatch(/^TA:[a-z_]+$/);
      expect(layers.has(s.layer)).toBe(true);
      expect(typeof s.name === 'object' && s.name.ar).toBeTruthy();
    }
    for (const id of ['TA:mitral_valve', 'TA:aortic_valve', 'TA:left_atrium', 'TA:left_anterior_descending']) expect(ids).toContain(id);
    const ms = heart.variants.find((v) => v.id === 'mitral_stenosis')!;
    expect(ms.pathological).toBe(true);
    expect(ms.affects).toEqual(expect.arrayContaining(['TA:mitral_valve', 'TA:left_atrium']));
    expect(heart.animations).toContain('cardiac_cycle');
  });

  it('[T2-09] kidney model: TA ids, valid layers and variants', () => {
    const k = getModel('kidney_v1')!;
    const layers = new Set(k.layers.map((l) => l.id));
    for (const s of k.structures) {
      expect(s.id).toMatch(/^TA:/);
      expect(layers.has(s.layer)).toBe(true);
    }
    expect(k.variants.map((v) => v.id)).toEqual(['normal', 'renal_cyst', 'hydronephrosis']);
    for (const m of MODELS) for (const v of m.variants) for (const a of v.affects ?? []) expect(m.structures.some((s) => s.id === a)).toBe(true);
  });
});

describe('case schema', () => {
  it('[T0-17] PRD §10 example validates against the heart model', () => {
    const r = validateCase(PRD_EXAMPLE, heart);
    expect(r.ok).toBe(true);
  });

  it('[T0-17] invalid cases are rejected with readable error paths', () => {
    const bad = clone(PRD_EXAMPLE) as Record<string, any>;
    delete bad.course;
    bad.questions[0].points = -1;
    bad.questions[1].type = 'essay';
    const r = validateCase(bad);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.startsWith('course:'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('questions[0].points:'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('questions[1].type:'))).toBe(true);
    expect(validateCase(null).ok).toBe(false);
    expect(validateCase({ ...clone(PRD_EXAMPLE), questions: [] }).ok).toBe(false);
  });

  it('[T0-17] model-aware checks: variant, layers, structure ids, option keys, unique ids', () => {
    const bad = clone(PRD_EXAMPLE) as Record<string, any>;
    bad.variant = 'aortic_dissection';
    bad.initial_view.hidden_layers = ['skin'];
    bad.allowed_layers = ['valves', 'bones'];
    bad.questions[0].answer = ['TA:spleen'];
    bad.questions[1].answer = 'e';
    bad.questions.push({ ...bad.questions[0], answer: ['TA:aorta'] });
    const r = validateCase(bad, heart);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const all = r.errors.join('\n');
    expect(all).toMatch(/variant: "aortic_dissection" does not exist/);
    expect(all).toMatch(/initial_view\.hidden_layers\[0\]: layer "skin"/);
    expect(all).toMatch(/allowed_layers\[1\]: layer "bones"/);
    expect(all).toMatch(/questions\[0\]\.answer: structure "TA:spleen"/);
    expect(all).toMatch(/questions\[1\]\.answer: "e" is not an option key/);
    expect(all).toMatch(/questions\[2\]\.id: duplicate question id "q1"/);
    // without a model, structure ids are not checked
    const ok = clone(PRD_EXAMPLE) as Record<string, any>;
    ok.questions[0].answer = ['TA:spleen'];
    expect(validateCase(ok).ok).toBe(true);
  });

  it('[T1-07] toPlayerCase strips answer keys and feedback and forces labels off', () => {
    const c = clone(HEART_CASES[0]);
    c.labels_visible = true;
    const p = toPlayerCase(c);
    expect(p.labels_visible).toBe(false);
    for (const q of p.questions) {
      expect('answer' in q).toBe(false);
      expect('feedback' in q).toBe(false);
    }
    expect(JSON.stringify(p)).not.toContain('"answer"');
    expect(p.questions[2].options).toEqual(c.questions[2].options);
    expect(c.questions[0].answer).toBeDefined(); // input not mutated
    expect(toPlayerCase(PRACTICE_CASE).labels_visible).toBe(true); // practice keeps labels
  });
});

describe('built-in content', () => {
  const valid = (c: CaseData) => {
    const r = validateCase(c, getModel(c.model));
    if (!r.ok) throw new Error(`${c.case_id}: ${r.errors.join('; ')}`);
    return r.ok;
  };

  it('[T0-23] three heart prototype cases with ~10 questions validate against the heart model', () => {
    expect(HEART_CASES).toHaveLength(3);
    const n = HEART_CASES.reduce((s, c) => s + c.questions.length, 0);
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(11);
    for (const c of HEART_CASES) {
      expect(c.course).toBe('Anatomy II - Thorax');
      expect(c.model).toBe('heart_v1');
      expect(valid(c)).toBe(true);
    }
    const types = new Set(HEART_CASES.flatMap((c) => c.questions.map((q) => q.type)));
    expect([...types].sort()).toEqual(['identify', 'mcq']);
    const card = HEART_CASES.find((c) => c.case_id === 'CARD-012')!;
    expect(card.variant).toBe('mitral_stenosis');
    expect(card.stem).toMatchObject({ en: PRD_EXAMPLE.stem });
    expect(card.questions[0]).toMatchObject({ type: 'identify', answer: ['TA:mitral_valve'], points: 2 });
    expect(card.questions[1]).toMatchObject({ type: 'mcq', answer: 'b', points: 1 });
    expect(new Set(HEART_CASES.map((c) => c.feedback_level)).size).toBeGreaterThan(1);
  });

  it('[T0-12] practice case is marked practice and validates', () => {
    expect(PRACTICE_CASE.practice).toBe(true);
    expect(PRACTICE_CASE.questions).toHaveLength(2);
    expect(valid(PRACTICE_CASE)).toBe(true);
    expect(BUILTIN_CASES.some((c) => c.practice)).toBe(false);
  });

  it('[T2-09] second course: kidney cases validate and include multi, order and text questions', () => {
    expect(KIDNEY_CASES).toHaveLength(2);
    for (const c of KIDNEY_CASES) {
      expect(c.course).toBe('Renal System');
      expect(valid(c)).toBe(true);
    }
    const types = KIDNEY_CASES.flatMap((c) => c.questions.map((q) => q.type));
    for (const t of ['multi', 'order', 'text']) expect(types).toContain(t);
  });
});

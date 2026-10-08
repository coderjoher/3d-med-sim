import { describe, expect, it } from 'vitest';
import { cohortComparison, itemAnalysis, pearson, questionAnalytics, structureHeatmap } from '../src/analytics.js';
import { SUS_ITEMS, susScore } from '../src/sus.js';
import { scoreCase } from '../src/scoring.js';
import { HEART_CASES } from '../src/content/index.js';
import type { AttemptForAnalytics, QuestionResult } from '../src/types.js';

const qr = (id: string, correct: boolean, response?: string | string[]): QuestionResult => ({
  question_id: id, type: 'mcq', points_awarded: correct ? 1 : 0, points_possible: 1, correct, pending_manual: false, response,
});
const att = (id: string, pct: number, qs: QuestionResult[], extra: Partial<AttemptForAnalytics> = {}): AttemptForAnalytics => ({
  attempt_id: id, student_id: 's' + id, case_id: 'C', score: pct, max_score: 100, questions: qs, ...extra,
});

describe('analytics', () => {
  it('[T1-12] per-question correct rate, average time and most common wrong answer', () => {
    const a = [
      att('1', 100, [qr('q1', true, 'b')], { time_per_question_ms: { q1: 1000 } }),
      att('2', 0, [qr('q1', false, 'a')], { time_per_question_ms: { q1: 3000 } }),
      att('3', 0, [qr('q1', false, 'a')]),
      att('4', 0, [qr('q1', false, 'c')], { time_per_question_ms: { q1: 2000 } }),
    ];
    const [q] = questionAnalytics(a);
    expect(q).toEqual({ question_id: 'q1', attempts: 4, correct_rate: 0.25, avg_time_ms: 2000, common_wrong: [{ response: 'a', count: 2 }, { response: 'c', count: 1 }] });
  });

  it('[T2-02] structure heatmap counts cohort misidentifications per structure', () => {
    const card = HEART_CASES.find((c) => c.case_id === 'CARD-012')!;
    const mk = (id: string, sel: string): AttemptForAnalytics => {
      const r = scoreCase(card, [{ question_id: 'q1', value: [sel], confirmed_at: 1 }]);
      return { attempt_id: id, student_id: id, case_id: card.case_id, score: r.score, max_score: r.max_score, questions: r.questions };
    };
    const heat = structureHeatmap([mk('1', 'TA:aortic_valve'), mk('2', 'TA:aortic_valve'), mk('3', 'TA:tricuspid_valve'), mk('4', 'TA:mitral_valve')], [card]);
    const by = Object.fromEntries(heat.map((h) => [h.structure_id, h]));
    expect(by['TA:mitral_valve']).toMatchObject({ missed: 3, wrongly_selected: 0, total: 3 });
    expect(by['TA:aortic_valve']).toMatchObject({ missed: 0, wrongly_selected: 2, total: 2 });
    expect(by['TA:tricuspid_valve']).toMatchObject({ missed: 0, wrongly_selected: 1 });
    expect(heat[0].structure_id).toBe('TA:mitral_valve');
    // mcq questions are ignored
    expect(heat.every((h) => h.structure_id.startsWith('TA:'))).toBe(true);
  });

  it('[T2-03] cohort comparison across groups and years', () => {
    const a = [
      att('1', 50, [], { cohort_id: 'A', year: 2026 }), att('2', 70, [], { cohort_id: 'A', year: 2026 }), att('3', 90, [], { cohort_id: 'A', year: 2027 }),
      att('4', 40, [], { cohort_id: 'B', year: 2027 }), att('5', 60, [], { cohort_id: 'B', year: 2027 }),
    ];
    expect(cohortComparison(a, 'cohort')).toEqual([
      { group: 'A', n: 3, mean_percent: 70, median_percent: 70, sd_percent: 20 },
      { group: 'B', n: 2, mean_percent: 50, median_percent: 50, sd_percent: 14.14 },
    ]);
    const years = cohortComparison(a, 'year');
    expect(years.map((y) => [y.group, y.n, y.mean_percent, y.median_percent])).toEqual([['2026', 2, 60, 60], ['2027', 3, 63.33, 60]]);
  });

  it('[T2-04] item analysis: difficulty, upper/lower 27% discrimination and point-biserial (hand-computed)', () => {
    // totals 100, 75, 50, 25 -> n=4, k=round(1.08)=1 (top 1 vs bottom 1)
    const a = [
      att('1', 100, [qr('q1', true), qr('q2', true)]),
      att('2', 75, [qr('q1', true), qr('q2', false)]),
      att('3', 50, [qr('q1', true), qr('q2', false)]),
      att('4', 25, [qr('q1', false), qr('q2', true)]),
    ];
    const [q1, q2] = itemAnalysis(a);
    expect(q1).toMatchObject({ question_id: 'q1', n: 4, difficulty: 0.75, discrimination: 1 });
    // r = 37.5 / sqrt(0.75 * 3125) = 0.7746
    expect(q1.point_biserial).toBeCloseTo(0.7746, 4);
    expect(q2).toMatchObject({ difficulty: 0.5, discrimination: 0 });
    expect(q2.point_biserial).toBeCloseTo(0, 6);
    expect(itemAnalysis(a.slice(0, 3))[0].discrimination).toBeNull();
  });

  it('[T3-03] pearson correlation for score-exam correlation', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
    expect(pearson([1, 2, 3], [1, 3, 2])).toBeCloseTo(0.5);
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe('SUS', () => {
  it('[T2-10] SUS scored with the standard formula; bilingual items', () => {
    expect(susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toBe(50);
    expect(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
    expect(susScore([4, 2, 4, 2, 4, 2, 4, 2, 4, 2])).toBe(75);
    expect(() => susScore([3, 3, 3])).toThrow();
    expect(() => susScore([0, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toThrow();
    expect(() => susScore([3.5, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toThrow();
    expect(SUS_ITEMS).toHaveLength(10);
    for (const i of SUS_ITEMS) { expect(i.en).toBeTruthy(); expect(i.ar).toMatch(/[؀-ۿ]/); }
  });
});

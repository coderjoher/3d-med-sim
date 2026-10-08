import type { AnswerValue, AttemptForAnalytics, CaseData, CohortStats, ItemAnalysis, QuestionAnalytics, QuestionResult, StructureHeat } from './types.js';

const round = (n: number, dp = 4) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

function responseKey(v: AnswerValue | undefined): string | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.length ? v.join(',') : null;
  const s = v.trim();
  return s ? s : null;
}

function asList(v: AnswerValue | undefined): string[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).filter((s) => s !== '');
}

/** R-02 */
export function questionAnalytics(attempts: AttemptForAnalytics[]): QuestionAnalytics[] {
  const groups = new Map<string, { n: number; correct: number; times: number[]; wrong: Map<string, number> }>();
  for (const a of attempts) {
    for (const q of a.questions) {
      let g = groups.get(q.question_id);
      if (!g) groups.set(q.question_id, (g = { n: 0, correct: 0, times: [], wrong: new Map() }));
      g.n++;
      if (q.correct) g.correct++;
      const tm = a.time_per_question_ms?.[q.question_id];
      if (typeof tm === 'number' && Number.isFinite(tm)) g.times.push(tm);
      if (!q.correct && !q.pending_manual) {
        const k = responseKey(q.response);
        if (k !== null) g.wrong.set(k, (g.wrong.get(k) ?? 0) + 1);
      }
    }
  }
  return [...groups.entries()].map(([question_id, g]) => ({
    question_id,
    attempts: g.n,
    correct_rate: g.n ? round(g.correct / g.n) : 0,
    avg_time_ms: g.times.length ? round(g.times.reduce((s, x) => s + x, 0) / g.times.length, 1) : null,
    common_wrong: [...g.wrong.entries()]
      .map(([response, count]) => ({ response, count }))
      .sort((x, y) => y.count - x.count || x.response.localeCompare(y.response)),
  }));
}

/**
 * R-03: for identify questions; cases supply the answer keys.
 * For each wrong identify answer: every target structure not chosen gets `missed`+1,
 * every chosen non-target gets `wrongly_selected`+1. `total` = missed + wrongly_selected.
 * Sorted by total descending.
 */
export function structureHeatmap(attempts: AttemptForAnalytics[], cases: CaseData[]): StructureHeat[] {
  const byCase = new Map(cases.map((c) => [c.case_id, c]));
  const heat = new Map<string, StructureHeat>();
  const get = (id: string) => {
    let h = heat.get(id);
    if (!h) heat.set(id, (h = { structure_id: id, missed: 0, wrongly_selected: 0, total: 0 }));
    return h;
  };
  for (const a of attempts) {
    const c = byCase.get(a.case_id);
    if (!c) continue;
    for (const r of a.questions) {
      if (r.correct) continue;
      const q = c.questions.find((x) => x.id === r.question_id);
      if (!q || q.type !== 'identify') continue;
      const key = asList(q.answer);
      const resp = asList(r.response);
      for (const k of key) if (!resp.includes(k)) { const h = get(k); h.missed++; h.total++; }
      for (const s of resp) if (!key.includes(s)) { const h = get(s); h.wrongly_selected++; h.total++; }
    }
  }
  return [...heat.values()].sort((x, y) => y.total - x.total || x.structure_id.localeCompare(y.structure_id));
}

const itemScore = (q: QuestionResult) => (q.points_possible > 0 ? q.points_awarded / q.points_possible : q.correct ? 1 : 0);
const attemptPercent = (a: AttemptForAnalytics) => (a.max_score > 0 ? (a.score / a.max_score) * 100 : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** R-06: difficulty (p), upper/lower 27% discrimination (null if n<4), point-biserial. */
export function itemAnalysis(attempts: AttemptForAnalytics[]): ItemAnalysis[] {
  const ids: string[] = [];
  for (const a of attempts) for (const q of a.questions) if (!ids.includes(q.question_id)) ids.push(q.question_id);
  return ids.map((id) => {
    const rows = attempts
      .map((a) => ({ total: attemptPercent(a), q: a.questions.find((q) => q.question_id === id) }))
      .filter((r): r is { total: number; q: QuestionResult } => !!r.q)
      .map((r) => ({ total: r.total, item: itemScore(r.q) }));
    const n = rows.length;
    const difficulty = n ? round(mean(rows.map((r) => r.item))) : 0;
    let discrimination: number | null = null;
    if (n >= 4) {
      const sorted = rows.map((r, i) => ({ ...r, i })).sort((x, y) => y.total - x.total || x.i - y.i);
      const k = Math.max(1, Math.round(n * 0.27));
      const upper = sorted.slice(0, k).map((r) => r.item);
      const lower = sorted.slice(n - k).map((r) => r.item);
      discrimination = round(mean(upper) - mean(lower));
    }
    const pb = pearson(rows.map((r) => r.item), rows.map((r) => r.total));
    return { question_id: id, difficulty, discrimination, point_biserial: pb === null ? null : round(pb), n };
  });
}

/** R-04: group attempts by cohort_id or year. */
export function cohortComparison(attempts: AttemptForAnalytics[], by: 'cohort' | 'year'): CohortStats[] {
  const groups = new Map<string, number[]>();
  for (const a of attempts) {
    const g = by === 'cohort' ? (a.cohort_id ?? 'unknown') : a.year !== undefined ? String(a.year) : 'unknown';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(attemptPercent(a));
  }
  return [...groups.entries()]
    .map(([group, xs]) => {
      const sorted = [...xs].sort((p, q) => p - q);
      const n = xs.length;
      const m = mean(xs);
      const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
      const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : 0;
      return { group, n, mean_percent: round(m, 2), median_percent: round(median, 2), sd_percent: round(sd, 2) };
    })
    .sort((x, y) => x.group.localeCompare(y.group, undefined, { numeric: true }));
}

/** Pearson correlation; null if fewer than 3 pairs or zero variance. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const x = xs.slice(0, n);
  const y = ys.slice(0, n);
  if (x.some((v) => !Number.isFinite(v)) || y.some((v) => !Number.isFinite(v))) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx <= 1e-12 || syy <= 1e-12) return null;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

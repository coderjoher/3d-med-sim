import type { AttemptForAnalytics, CaseData, CohortStats, ItemAnalysis, QuestionAnalytics, StructureHeat } from './types.js';
/** R-02 */
export function questionAnalytics(attempts: AttemptForAnalytics[]): QuestionAnalytics[] { throw new Error("not implemented"); }
/** R-03: for identify questions; cases supply the answer keys. */
export function structureHeatmap(attempts: AttemptForAnalytics[], cases: CaseData[]): StructureHeat[] { throw new Error("not implemented"); }
/** R-06: difficulty (p), upper/lower 27% discrimination (null if n<4), point-biserial. */
export function itemAnalysis(attempts: AttemptForAnalytics[]): ItemAnalysis[] { throw new Error("not implemented"); }
/** R-04: group attempts by cohort_id or year. */
export function cohortComparison(attempts: AttemptForAnalytics[], by: 'cohort' | 'year'): CohortStats[] { throw new Error("not implemented"); }
/** Pearson correlation; null if fewer than 3 pairs or zero variance. */
export function pearson(xs: number[], ys: number[]): number | null { throw new Error("not implemented"); }

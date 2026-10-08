import type { CaseData, ModelDef } from '../types.js';
/** Model registry (placeholder procedural models; asset_url may point to licensed glTF later). */
export const MODELS: ModelDef[] = [];
export function getModel(id: string): ModelDef | undefined { throw new Error("not implemented"); }
/** Built-in content: the non-graded practice case, the 3 prototype heart cases (Anatomy II – Thorax) and 2 kidney cases (second course). */
export const PRACTICE_CASE: CaseData = undefined as unknown as CaseData;
export const BUILTIN_CASES: CaseData[] = [];

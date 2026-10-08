import type { CaseData, ModelDef, PlayerCase } from './types.js';
export type ValidationResult = { ok: true; case: CaseData } | { ok: false; errors: string[] };
/** Validate unknown JSON as CaseData (C-01). If a model is given, also checks variant, layers and identify-answer structure ids exist in it. */
export function validateCase(data: unknown, model?: ModelDef): ValidationResult { throw new Error("not implemented"); }
/** Remove answer keys and feedback (NFR security) and force labels off (V-05 assessment mode). */
export function toPlayerCase(c: CaseData): PlayerCase { throw new Error("not implemented"); }

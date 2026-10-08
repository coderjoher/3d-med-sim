import type { CaseData, ModelDef } from './types.js';
export interface ConversionError { sheet: string; row: number; case_id?: string; message: string }
export interface ConversionResult { cases: CaseData[]; errors: ConversionError[] }
/**
 * A-01: Convert the academic Case Template workbook to case JSON.
 * Sheet "Cases": case_id, course, topic, model, variant, stem_en, stem_ar, camera, hidden_layers (comma list),
 *   labels_visible (yes/no), time_limit_min, allowed_layers, feedback_level, author, reviewer, version, status, objectives (; list), difficulty
 * Sheet "Questions": case_id, question_id, type, prompt_en, prompt_ar, options ("a=Congenital|b=Rheumatic"), answer (comma list), points,
 *   feedback_en, feedback_ar, match, partial_credit
 * Structure answers may be written as TA ids ("TA:mitral_valve") or structure display names (resolved via models).
 */
export async function convertWorkbook(data: ArrayBuffer | Uint8Array, models?: ModelDef[]): Promise<ConversionResult> { throw new Error("not implemented"); }
/** Same as convertWorkbook but from the two sheets exported as CSV text. */
export function convertCsv(casesCsv: string, questionsCsv: string, models?: ModelDef[]): ConversionResult { throw new Error("not implemented"); }
/** Blank template with headers, an instructions sheet and one example row. */
export async function buildTemplateWorkbook(): Promise<Uint8Array> { throw new Error("not implemented"); }

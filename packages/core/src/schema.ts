import { z } from 'zod';
import type { CaseData, ModelDef, PlayerCase } from './types.js';

export type ValidationResult = { ok: true; case: CaseData } | { ok: false; errors: string[] };

const localizedText = z.union([
  z.string().min(1, 'must not be empty'),
  z.object({ en: z.string().min(1, 'English text is required'), ar: z.string().optional() }).strict(),
]);

const cameraView = z
  .object({
    camera: z.enum(['anterior', 'posterior', 'left', 'right', 'superior', 'inferior', 'custom']),
    alpha: z.number().finite().optional(),
    beta: z.number().finite().optional(),
    radius: z.number().positive().optional(),
    hidden_layers: z.array(z.string()).optional(),
  })
  .strict();

const answer = z.union([z.string(), z.array(z.string())]);

const question = z
  .object({
    id: z.string().min(1, 'question id is required'),
    type: z.enum(['identify', 'mcq', 'multi', 'order', 'text']),
    prompt: localizedText,
    options: z.record(z.string(), localizedText).optional(),
    answer: answer.optional(),
    points: z.number().finite().min(0, 'points must be >= 0'),
    match: z.enum(['any', 'all']).optional(),
    partial_credit: z.boolean().optional(),
    feedback: localizedText.optional(),
    view: cameraView.optional(),
  })
  .strict();

const caseSchema = z
  .object({
    case_id: z.string().min(1, 'case_id is required'),
    course: z.string().min(1, 'course is required'),
    topic: z.string().optional(),
    model: z.string().min(1, 'model is required'),
    variant: z.string().min(1, 'variant is required'),
    stem: localizedText,
    initial_view: cameraView,
    labels_visible: z.boolean().optional(),
    time_limit_min: z.number().positive('time_limit_min must be > 0').optional(),
    allowed_layers: z.array(z.string()).optional(),
    feedback_level: z.enum(['none', 'score', 'full']).optional(),
    practice: z.boolean().optional(),
    questions: z.array(question).min(1, 'a case needs at least one question'),
    meta: z
      .object({
        author: z.string().optional(),
        reviewer: z.string().optional(),
        version: z.number().int().positive().optional(),
        status: z.enum(['draft', 'in_review', 'published', 'archived']).optional(),
        objectives: z.array(z.string()).optional(),
        difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function fmtPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const p of path) {
    if (typeof p === 'number') out += `[${p}]`;
    else out += out ? `.${String(p)}` : String(p);
  }
  return out || '(root)';
}

function asArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Semantic checks independent of a model (answers vs options, unique ids). */
function checkSemantics(c: CaseData, errors: string[]): void {
  const seen = new Set<string>();
  c.questions.forEach((q, i) => {
    const at = `questions[${i}]`;
    if (seen.has(q.id)) errors.push(`${at}.id: duplicate question id "${q.id}"`);
    seen.add(q.id);
    const keys = asArray(q.answer);
    const opts = q.options ? Object.keys(q.options) : [];
    switch (q.type) {
      case 'identify':
        if (keys.length === 0) errors.push(`${at}.answer: identify question needs at least one structure id`);
        break;
      case 'mcq':
        if (opts.length < 2) errors.push(`${at}.options: mcq needs at least 2 options`);
        if (keys.length !== 1) errors.push(`${at}.answer: mcq needs exactly one answer key`);
        break;
      case 'multi':
        if (opts.length < 2) errors.push(`${at}.options: multi needs at least 2 options`);
        if (keys.length === 0) errors.push(`${at}.answer: multi needs at least one answer key`);
        if (new Set(keys).size !== keys.length) errors.push(`${at}.answer: duplicate answer keys`);
        break;
      case 'order':
        if (opts.length < 2) errors.push(`${at}.options: order needs at least 2 options`);
        if (keys.length !== opts.length || new Set(keys).size !== keys.length)
          errors.push(`${at}.answer: order answer must list every option key exactly once`);
        break;
      case 'text':
        break;
    }
    if (q.type === 'mcq' || q.type === 'multi' || q.type === 'order') {
      for (const k of keys) if (!opts.includes(k)) errors.push(`${at}.answer: "${k}" is not an option key (${opts.join(', ')})`);
    }
    if (q.match && q.type !== 'identify') errors.push(`${at}.match: only valid for identify questions`);
    if (q.partial_credit !== undefined && q.type !== 'multi') errors.push(`${at}.partial_credit: only valid for multi questions`);
  });
}

function checkModel(c: CaseData, model: ModelDef, errors: string[]): void {
  if (c.model !== model.id) errors.push(`model: case uses "${c.model}" but was validated against "${model.id}"`);
  if (!model.variants.some((v) => v.id === c.variant))
    errors.push(`variant: "${c.variant}" does not exist in model ${model.id} (${model.variants.map((v) => v.id).join(', ')})`);
  const layers = new Set(model.layers.map((l) => l.id));
  const structures = new Set(model.structures.map((s) => s.id));
  const checkLayers = (list: string[] | undefined, at: string) =>
    (list ?? []).forEach((l, i) => {
      if (!layers.has(l)) errors.push(`${at}[${i}]: layer "${l}" does not exist in model ${model.id}`);
    });
  checkLayers(c.initial_view.hidden_layers, 'initial_view.hidden_layers');
  checkLayers(c.allowed_layers, 'allowed_layers');
  c.questions.forEach((q, i) => {
    if (q.view) checkLayers(q.view.hidden_layers, `questions[${i}].view.hidden_layers`);
    if (q.type === 'identify')
      for (const s of asArray(q.answer))
        if (!structures.has(s)) errors.push(`questions[${i}].answer: structure "${s}" does not exist in model ${model.id}`);
  });
}

/** Validate unknown JSON as CaseData (C-01). If a model is given, also checks variant, layers and identify-answer structure ids exist in it. */
export function validateCase(data: unknown, model?: ModelDef): ValidationResult {
  const parsed = caseSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((iss) => `${fmtPath(iss.path)}: ${iss.message}`) };
  }
  const c = parsed.data as CaseData;
  const errors: string[] = [];
  checkSemantics(c, errors);
  if (model) checkModel(c, model, errors);
  return errors.length ? { ok: false, errors } : { ok: true, case: c };
}

/** Remove answer keys and feedback (NFR security) and force labels off (V-05 assessment mode). */
export function toPlayerCase(c: CaseData): PlayerCase {
  const { questions, ...rest } = c;
  const copy = JSON.parse(JSON.stringify(rest)) as Omit<CaseData, 'questions'>;
  return {
    ...copy,
    labels_visible: c.practice ? (c.labels_visible ?? false) : false,
    questions: questions.map((q) => {
      const { answer: _a, feedback: _f, ...pq } = q;
      return JSON.parse(JSON.stringify(pq));
    }),
  };
}

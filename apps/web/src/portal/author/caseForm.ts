/**
 * Pure conversion between the authoring web form state (A-02, A-07) and case JSON (PRD §10).
 * The form always carries both languages; empty Arabic text is omitted from the output.
 */
import type { CameraView, CaseData, CaseQuestion, FeedbackLevel, LocalizedText, ModelDef, QuestionType } from '@medsim/core';

export interface Bi { en: string; ar: string }
export interface OptionForm { key: string; en: string; ar: string }
export interface QuestionForm {
  id: string;
  type: QuestionType;
  prompt: Bi;
  options: OptionForm[];
  /** identify: structure ids; mcq: [key]; multi: keys; order: keys in order; text: [model answer] */
  answer: string[];
  points: number;
  match: 'any' | 'all';
  partial_credit: boolean;
  feedback: Bi;
  view?: CameraView;
}
export interface CaseForm {
  case_id: string;
  course_id: string;
  course_code: string;
  topic: string;
  model: string;
  variant: string;
  stem: Bi;
  initial_view: CameraView;
  labels_visible: boolean;
  time_limit_min: string; // text input; '' = no limit
  allowed_layers: string[]; // [] = all
  feedback_level: FeedbackLevel;
  practice: boolean;
  objectives: string; // one per line
  difficulty: '' | 'easy' | 'medium' | 'hard';
  questions: QuestionForm[];
}

export const QUESTION_TYPES: QuestionType[] = ['identify', 'mcq', 'multi', 'order', 'text'];
export const CAMERA_PRESETS: CameraView['camera'][] = ['anterior', 'posterior', 'left', 'right', 'superior', 'inferior', 'custom'];

const bi = (t: LocalizedText | undefined): Bi =>
  t === undefined ? { en: '', ar: '' } : typeof t === 'string' ? { en: t, ar: '' } : { en: t.en ?? '', ar: t.ar ?? '' };

export function toText(b: Bi): LocalizedText {
  const en = b.en.trim();
  const ar = b.ar.trim();
  return ar ? { en, ar } : en;
}

export function newQuestion(index: number, type: QuestionType = 'mcq'): QuestionForm {
  return {
    id: `q${index + 1}`,
    type,
    prompt: { en: '', ar: '' },
    options: type === 'identify' || type === 'text' ? [] : [{ key: 'A', en: '', ar: '' }, { key: 'B', en: '', ar: '' }],
    answer: [],
    points: 1,
    match: 'any',
    partial_credit: false,
    feedback: { en: '', ar: '' },
  };
}

export function emptyForm(model?: ModelDef, course?: { id: string; code: string }): CaseForm {
  return {
    case_id: '',
    course_id: course?.id ?? '',
    course_code: course?.code ?? '',
    topic: '',
    model: model?.id ?? '',
    variant: model?.variants[0]?.id ?? '',
    stem: { en: '', ar: '' },
    initial_view: { camera: 'anterior', hidden_layers: [] },
    labels_visible: false,
    time_limit_min: '',
    allowed_layers: [],
    feedback_level: 'score',
    practice: false,
    objectives: '',
    difficulty: '',
    questions: [newQuestion(0)],
  };
}

export function caseToForm(c: CaseData, courseId: string): CaseForm {
  return {
    case_id: c.case_id,
    course_id: courseId,
    course_code: c.course,
    topic: c.topic ?? '',
    model: c.model,
    variant: c.variant,
    stem: bi(c.stem),
    initial_view: { ...c.initial_view, hidden_layers: [...(c.initial_view.hidden_layers ?? [])] },
    labels_visible: !!c.labels_visible,
    time_limit_min: c.time_limit_min !== undefined ? String(c.time_limit_min) : '',
    allowed_layers: [...(c.allowed_layers ?? [])],
    feedback_level: c.feedback_level ?? 'score',
    practice: !!c.practice,
    objectives: (c.meta?.objectives ?? []).join('\n'),
    difficulty: c.meta?.difficulty ?? '',
    questions: c.questions.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: bi(q.prompt),
      options: Object.entries(q.options ?? {}).map(([key, t]) => ({ key, ...bi(t) })),
      answer: q.answer === undefined ? [] : Array.isArray(q.answer) ? [...q.answer] : [q.answer],
      points: q.points,
      match: q.match ?? 'any',
      partial_credit: !!q.partial_credit,
      feedback: bi(q.feedback),
      view: q.view,
    })),
  };
}

function cleanView(v: CameraView): CameraView {
  const out: CameraView = { camera: v.camera };
  if (v.camera === 'custom') {
    if (v.alpha !== undefined) out.alpha = v.alpha;
    if (v.beta !== undefined) out.beta = v.beta;
    if (v.radius !== undefined) out.radius = v.radius;
  }
  if (v.hidden_layers && v.hidden_layers.length) out.hidden_layers = [...v.hidden_layers];
  return out;
}

export function formToQuestion(q: QuestionForm): CaseQuestion {
  const out: CaseQuestion = { id: q.id.trim(), type: q.type, prompt: toText(q.prompt), points: Number(q.points) };
  if (q.type === 'mcq' || q.type === 'multi' || q.type === 'order') {
    out.options = Object.fromEntries(q.options.map((o) => [o.key.trim(), toText(o)]));
  }
  const keys = q.answer.map((a) => a.trim()).filter(Boolean);
  switch (q.type) {
    case 'mcq': if (keys.length) out.answer = keys.length === 1 ? keys[0] : keys; break;
    case 'text': if (keys.length) out.answer = keys[0]; break;
    default: out.answer = keys;
  }
  if (q.type === 'identify' && q.match === 'all') out.match = 'all';
  if (q.type === 'multi') out.partial_credit = q.partial_credit;
  if (q.feedback.en.trim()) out.feedback = toText(q.feedback);
  if (q.view) out.view = cleanView(q.view);
  return out;
}

/** Build case JSON from the form. Validate the result with core `validateCase` before saving. */
export function formToCase(f: CaseForm): CaseData {
  const c: CaseData = {
    case_id: f.case_id.trim(),
    course: f.course_code,
    model: f.model,
    variant: f.variant,
    stem: toText(f.stem),
    initial_view: cleanView(f.initial_view),
    labels_visible: f.labels_visible,
    feedback_level: f.feedback_level,
    questions: f.questions.map(formToQuestion),
  };
  if (f.topic.trim()) c.topic = f.topic.trim();
  const tl = f.time_limit_min.trim();
  if (tl) c.time_limit_min = Number(tl);
  if (f.allowed_layers.length) c.allowed_layers = [...f.allowed_layers];
  if (f.practice) c.practice = true;
  const objectives = f.objectives.split('\n').map((s) => s.trim()).filter(Boolean);
  if (objectives.length || f.difficulty) {
    c.meta = {};
    if (objectives.length) c.meta.objectives = objectives;
    if (f.difficulty) c.meta.difficulty = f.difficulty;
  }
  return c;
}

/** Toggle a structure in an identify question's answer targets (A-03 visual tagging). */
export function toggleTarget(q: QuestionForm, structureId: string): QuestionForm {
  const has = q.answer.includes(structureId);
  return { ...q, answer: has ? q.answer.filter((a) => a !== structureId) : [...q.answer, structureId] };
}

/** Next unused option key: A, B, … Z, AA … */
export function nextOptionKey(opts: OptionForm[]): string {
  const used = new Set(opts.map((o) => o.key));
  for (let i = 0; i < 702; i++) {
    const k = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
    if (!used.has(k)) return k;
  }
  return `K${opts.length}`;
}

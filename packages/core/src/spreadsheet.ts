import ExcelJS from 'exceljs';
import type { CameraView, CaseData, CaseQuestion, LocalizedText, ModelDef, QuestionType } from './types.js';
import { validateCase } from './schema.js';
import { parseCsv, toCsv } from './csv.js';
import { MODELS } from './content/index.js';

export interface ConversionError { sheet: string; row: number; case_id?: string; message: string }
export interface ConversionResult { cases: CaseData[]; errors: ConversionError[] }

/** Column order of the "Cases" sheet (A-01). Columns after `stem_ar` beyond the PRD list are optional. */
export const CASE_COLUMNS = [
  'case_id', 'course', 'topic', 'model', 'variant', 'stem_en', 'stem_ar', 'camera', 'alpha', 'beta', 'radius',
  'hidden_layers', 'labels_visible', 'time_limit_min', 'allowed_layers', 'feedback_level', 'practice',
  'author', 'reviewer', 'version', 'status', 'objectives', 'difficulty',
] as const;

/** Column order of the "Questions" sheet (A-01). */
export const QUESTION_COLUMNS = [
  'case_id', 'question_id', 'type', 'prompt_en', 'prompt_ar', 'options', 'options_ar', 'answer', 'points',
  'feedback_en', 'feedback_ar', 'match', 'partial_credit',
] as const;

const REQUIRED_CASE = ['case_id', 'course', 'model', 'variant', 'stem_en'];
const REQUIRED_QUESTION = ['case_id', 'question_id', 'type', 'prompt_en', 'points'];
const QUESTION_TYPES: QuestionType[] = ['identify', 'mcq', 'multi', 'order', 'text'];

interface SheetRow { row: number; values: Record<string, string> }

const normHeader = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');
const splitList = (s: string, sep: RegExp | string = ',') =>
  s.split(sep).map((x) => x.trim()).filter((x) => x.length > 0);

function loc(en: string, ar: string): LocalizedText | undefined {
  if (!en && !ar) return undefined;
  return ar ? { en, ar } : en;
}

function parseOptions(s: string): Array<[string, string]> | string {
  const out: Array<[string, string]> = [];
  for (const part of splitList(s, '|')) {
    const i = part.indexOf('=');
    if (i <= 0) return `option "${part}" must be written as key=text (e.g. "a=Congenital|b=Rheumatic")`;
    out.push([part.slice(0, i).trim(), part.slice(i + 1).trim()]);
  }
  return out;
}

function resolveStructure(token: string, model: ModelDef | undefined): string {
  if (!model) return token;
  if (model.structures.some((s) => s.id === token)) return token;
  const lower = token.trim().toLowerCase();
  const asId = 'TA:' + lower.replace(/^ta:/, '').replace(/[\s-]+/g, '_');
  const byId = model.structures.find((s) => s.id.toLowerCase() === asId);
  if (byId) return byId.id;
  const byName = model.structures.find((s) => {
    const n = s.name;
    if (typeof n === 'string') return n.toLowerCase() === lower;
    return n.en.toLowerCase() === lower || (n.ar ?? '').trim() === token.trim();
  });
  return byName ? byName.id : token;
}

function convertRows(
  caseRows: SheetRow[],
  questionRows: SheetRow[],
  models: ModelDef[],
  sheets: { cases: string; questions: string },
): ConversionResult {
  const errors: ConversionError[] = [];
  const failed = new Set<string>();
  const built = new Map<string, { data: CaseData; row: number; qRows: number[] }>();

  const err = (sheet: string, row: number, message: string, case_id?: string) => {
    errors.push({ sheet, row, message, ...(case_id ? { case_id } : {}) });
    if (case_id) failed.add(case_id);
  };

  for (const { row, values: v } of caseRows) {
    const id = v.case_id ?? '';
    if (!id) { err(sheets.cases, row, 'case_id is required'); continue; }
    if (built.has(id)) { err(sheets.cases, row, `duplicate case_id "${id}"`, id); continue; }
    const e = (m: string) => err(sheets.cases, row, m, id);
    for (const col of REQUIRED_CASE) if (!v[col]) e(`${col} is required`);

    const num = (col: string): number | undefined => {
      const s = v[col] ?? '';
      if (!s) return undefined;
      const n = Number(s);
      if (!Number.isFinite(n)) { e(`${col} must be a number (got "${s}")`); return undefined; }
      return n;
    };
    const bool = (col: string): boolean | undefined => parseBool(v[col] ?? '', (m) => e(`${col} ${m}`));

    const camera = (v.camera || 'anterior').toLowerCase() as CameraView['camera'];
    const initial_view: CameraView = { camera };
    const alpha = num('alpha'), beta = num('beta'), radius = num('radius');
    if (alpha !== undefined) initial_view.alpha = alpha;
    if (beta !== undefined) initial_view.beta = beta;
    if (radius !== undefined) initial_view.radius = radius;
    const hidden = splitList(v.hidden_layers ?? '');
    if (hidden.length) initial_view.hidden_layers = hidden;

    const data: CaseData = {
      case_id: id,
      course: v.course ?? '',
      model: v.model ?? '',
      variant: v.variant ?? '',
      stem: loc(v.stem_en ?? '', v.stem_ar ?? '') ?? '',
      initial_view,
      questions: [],
    };
    if (v.topic) data.topic = v.topic;
    const labels = bool('labels_visible');
    if (labels !== undefined) data.labels_visible = labels;
    const tl = num('time_limit_min');
    if (tl !== undefined) data.time_limit_min = tl;
    const allowed = splitList(v.allowed_layers ?? '');
    if (allowed.length) data.allowed_layers = allowed;
    if (v.feedback_level) data.feedback_level = v.feedback_level.toLowerCase() as CaseData['feedback_level'];
    const practice = bool('practice');
    if (practice !== undefined) data.practice = practice;

    const meta: NonNullable<CaseData['meta']> = {};
    if (v.author) meta.author = v.author;
    if (v.reviewer) meta.reviewer = v.reviewer;
    const version = num('version');
    if (version !== undefined) meta.version = version;
    if (v.status) meta.status = v.status.toLowerCase() as NonNullable<CaseData['meta']>['status'];
    const objectives = splitList(v.objectives ?? '', ';');
    if (objectives.length) meta.objectives = objectives;
    if (v.difficulty) meta.difficulty = v.difficulty.toLowerCase() as NonNullable<CaseData['meta']>['difficulty'];
    if (Object.keys(meta).length) data.meta = meta;

    built.set(id, { data, row, qRows: [] });
  }

  for (const { row, values: v } of questionRows) {
    const cid = v.case_id ?? '';
    const e = (m: string) => err(sheets.questions, row, m, cid || undefined);
    if (!cid) { e('case_id is required'); continue; }
    const target = built.get(cid);
    if (!target) { e(`case_id "${cid}" is not defined in the ${sheets.cases} sheet`); continue; }
    for (const col of REQUIRED_QUESTION) if (!v[col]) e(`${col} is required`);
    const type = (v.type ?? '').toLowerCase() as QuestionType;
    if (v.type && !QUESTION_TYPES.includes(type)) e(`type must be one of ${QUESTION_TYPES.join(', ')} (got "${v.type}")`);
    const points = Number(v.points);
    if (v.points && !Number.isFinite(points)) e(`points must be a number (got "${v.points}")`);

    const q: CaseQuestion = {
      id: v.question_id ?? '',
      type,
      prompt: loc(v.prompt_en ?? '', v.prompt_ar ?? '') ?? '',
      points: Number.isFinite(points) ? points : 0,
    };

    if (v.options) {
      const en = parseOptions(v.options);
      const ar = v.options_ar ? parseOptions(v.options_ar) : [];
      if (typeof en === 'string') e(`options: ${en}`);
      else if (typeof ar === 'string') e(`options_ar: ${ar}`);
      else {
        const arMap = new Map(ar);
        for (const k of arMap.keys()) if (!en.some(([key]) => key === k)) e(`options_ar: key "${k}" is not in options`);
        q.options = {};
        for (const [k, text] of en) q.options[k] = loc(text, arMap.get(k) ?? '') ?? '';
      }
    }

    const ans = v.answer ?? '';
    if (ans) {
      const model = models.find((m) => m.id === target.data.model);
      if (type === 'text') q.answer = ans;
      else if (type === 'mcq') {
        const list = splitList(ans);
        q.answer = list.length === 1 ? list[0] : list;
      } else if (type === 'identify') q.answer = splitList(ans).map((s) => resolveStructure(s, model));
      else q.answer = splitList(ans);
    } else if (type && type !== 'text') e('answer is required');

    const fb = loc(v.feedback_en ?? '', v.feedback_ar ?? '');
    if (fb !== undefined) q.feedback = fb;
    if (v.match) q.match = v.match.toLowerCase() as CaseQuestion['match'];
    const pc = parseBool(v.partial_credit ?? '', (m) => e(`partial_credit ${m}`));
    if (pc !== undefined) q.partial_credit = pc;

    target.data.questions.push(q);
    target.qRows.push(row);
  }

  const cases: CaseData[] = [];
  for (const [id, { data, row, qRows }] of built) {
    if (data.questions.length === 0 && !failed.has(id)) err(sheets.cases, row, 'case has no questions in the Questions sheet', id);
    const model = models.find((m) => m.id === data.model);
    if (!model) {
      if (data.model) err(sheets.cases, row, `unknown model "${data.model}" (known: ${models.map((m) => m.id).join(', ')})`, id);
      continue;
    }
    // Validate even cases that already have row errors so authors see every problem at once,
    // but don't repeat a message for a row that already has one.
    const flagged = new Set(errors.filter((e) => e.case_id === id).map((e) => `${e.sheet}:${e.row}`));
    const res = validateCase(data, model);
    if (!res.ok) {
      for (const msg of res.errors) {
        const m = /^questions\[(\d+)\]\.?(.*)$/.exec(msg);
        const qRow = m ? qRows[Number(m[1])] : undefined;
        const [sheet, r, text] = qRow !== undefined ? [sheets.questions, qRow, m![2] || msg] : [sheets.cases, row, msg];
        if (!flagged.has(`${sheet}:${r}`)) err(sheet, r, text, id);
      }
      continue;
    }
    if (failed.has(id)) continue;
    cases.push(res.case);
  }
  errors.sort((a, b) => (a.sheet === b.sheet ? a.row - b.row : a.sheet === sheets.cases ? -1 : 1));
  return { cases, errors };
}

function parseBool(s: string, onError: (m: string) => void): boolean | undefined {
  const x = s.trim().toLowerCase();
  if (!x) return undefined;
  if (['yes', 'y', 'true', '1', 'نعم'].includes(x)) return true;
  if (['no', 'n', 'false', '0', 'لا'].includes(x)) return false;
  onError(`must be yes or no (got "${s}")`);
  return undefined;
}

function rowsFromMatrix(matrix: string[][]): SheetRow[] {
  if (matrix.length === 0) return [];
  const headers = matrix[0].map(normHeader);
  const out: SheetRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i];
    if (cells.every((c) => !c || !c.trim())) continue;
    const values: Record<string, string> = {};
    headers.forEach((h, j) => {
      if (h) values[h] = (cells[j] ?? '').trim();
    });
    out.push({ row: i + 1, values });
  }
  return out;
}

function missingHeaders(matrix: string[][], required: string[]): string[] {
  const headers = (matrix[0] ?? []).map(normHeader);
  return required.filter((r) => !headers.includes(r));
}

function convertMatrices(casesM: string[][], questionsM: string[][], models: ModelDef[], sheets = { cases: 'Cases', questions: 'Questions' }): ConversionResult {
  const errors: ConversionError[] = [];
  const mc = missingHeaders(casesM, REQUIRED_CASE);
  const mq = missingHeaders(questionsM, REQUIRED_QUESTION);
  if (mc.length) errors.push({ sheet: sheets.cases, row: 1, message: `missing column(s): ${mc.join(', ')}` });
  if (mq.length) errors.push({ sheet: sheets.questions, row: 1, message: `missing column(s): ${mq.join(', ')}` });
  if (errors.length) return { cases: [], errors };
  return convertRows(rowsFromMatrix(casesM), rowsFromMatrix(questionsM), models, sheets);
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  try {
    return cell.text ?? '';
  } catch {
    return '';
  }
}

function sheetMatrix(ws: ExcelJS.Worksheet): string[][] {
  const out: string[][] = [];
  const width = ws.columnCount;
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c)));
    out[rowNumber - 1] = cells;
  });
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = [];
  return out;
}

function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((w) => w.name.trim().toLowerCase() === name.toLowerCase());
}

/**
 * A-01: Convert the academic Case Template workbook to case JSON.
 * Sheet "Cases": case_id, course, topic, model, variant, stem_en, stem_ar, camera, hidden_layers (comma list),
 *   labels_visible (yes/no), time_limit_min, allowed_layers, feedback_level, author, reviewer, version, status, objectives (; list), difficulty
 *   (optional extra columns: alpha, beta, radius for a custom camera; practice yes/no)
 * Sheet "Questions": case_id, question_id, type, prompt_en, prompt_ar, options ("a=Congenital|b=Rheumatic"), answer (comma list), points,
 *   feedback_en, feedback_ar, match, partial_credit  (optional: options_ar "a=خلقي|b=روماتيزمي")
 * Structure answers may be written as TA ids ("TA:mitral_valve") or structure display names (resolved via models).
 */
export async function convertWorkbook(data: ArrayBuffer | Uint8Array, models: ModelDef[] = MODELS): Promise<ConversionResult> {
  const wb = new ExcelJS.Workbook();
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(bytes as any);
  } catch (e) {
    return { cases: [], errors: [{ sheet: '(workbook)', row: 0, message: `cannot read workbook: ${(e as Error).message}` }] };
  }
  const cs = findSheet(wb, 'Cases');
  const qs = findSheet(wb, 'Questions');
  const errors: ConversionError[] = [];
  if (!cs) errors.push({ sheet: 'Cases', row: 0, message: 'sheet "Cases" not found' });
  if (!qs) errors.push({ sheet: 'Questions', row: 0, message: 'sheet "Questions" not found' });
  if (!cs || !qs) return { cases: [], errors };
  return convertMatrices(sheetMatrix(cs), sheetMatrix(qs), models, { cases: cs.name, questions: qs.name });
}

/** Same as convertWorkbook but from the two sheets exported as CSV text. */
export function convertCsv(casesCsv: string, questionsCsv: string, models: ModelDef[] = MODELS): ConversionResult {
  return convertMatrices(parseCsv(casesCsv), parseCsv(questionsCsv), models);
}

// ---------------------------------------------------------------------------
// Writing (template + exporting cases in template form)
// ---------------------------------------------------------------------------

const enOf = (t: LocalizedText | undefined) => (t === undefined ? '' : typeof t === 'string' ? t : t.en);
const arOf = (t: LocalizedText | undefined) => (t === undefined || typeof t === 'string' ? '' : (t.ar ?? ''));
const yesNo = (b: boolean | undefined) => (b === undefined ? '' : b ? 'yes' : 'no');

/** Flatten cases to template rows (one per case, one per question). */
export function casesToRows(cases: CaseData[]): { cases: Array<Record<string, string | number>>; questions: Array<Record<string, string | number>> } {
  const caseRows = cases.map((c) => ({
    case_id: c.case_id,
    course: c.course,
    topic: c.topic ?? '',
    model: c.model,
    variant: c.variant,
    stem_en: enOf(c.stem),
    stem_ar: arOf(c.stem),
    camera: c.initial_view.camera,
    alpha: c.initial_view.alpha ?? '',
    beta: c.initial_view.beta ?? '',
    radius: c.initial_view.radius ?? '',
    hidden_layers: (c.initial_view.hidden_layers ?? []).join(', '),
    labels_visible: yesNo(c.labels_visible),
    time_limit_min: c.time_limit_min ?? '',
    allowed_layers: (c.allowed_layers ?? []).join(', '),
    feedback_level: c.feedback_level ?? '',
    practice: yesNo(c.practice),
    author: c.meta?.author ?? '',
    reviewer: c.meta?.reviewer ?? '',
    version: c.meta?.version ?? '',
    status: c.meta?.status ?? '',
    objectives: (c.meta?.objectives ?? []).join('; '),
    difficulty: c.meta?.difficulty ?? '',
  }));
  const questionRows = cases.flatMap((c) =>
    c.questions.map((q) => {
      const opts = Object.entries(q.options ?? {});
      const answer = q.answer === undefined ? '' : Array.isArray(q.answer) ? q.answer.join(', ') : q.answer;
      return {
        case_id: c.case_id,
        question_id: q.id,
        type: q.type,
        prompt_en: enOf(q.prompt),
        prompt_ar: arOf(q.prompt),
        options: opts.map(([k, v]) => `${k}=${enOf(v)}`).join('|'),
        options_ar: opts.some(([, v]) => arOf(v)) ? opts.map(([k, v]) => `${k}=${arOf(v)}`).join('|') : '',
        answer,
        points: q.points,
        feedback_en: enOf(q.feedback),
        feedback_ar: arOf(q.feedback),
        match: q.match ?? '',
        partial_credit: yesNo(q.partial_credit),
      };
    }),
  );
  return { cases: caseRows, questions: questionRows };
}

/** Export cases as the two template sheets in CSV form. */
export function casesToCsv(cases: CaseData[]): { cases: string; questions: string } {
  const rows = casesToRows(cases);
  return { cases: toCsv(rows.cases, [...CASE_COLUMNS]), questions: toCsv(rows.questions, [...QUESTION_COLUMNS]) };
}

const INSTRUCTIONS: Array<[string, string]> = [
  ['MedSim Lab — Case Template', 'Fill one row per case in "Cases" and one row per question in "Questions". Do not rename the sheets or header cells.'],
  ['', ''],
  ['Cases sheet', ''],
  ['case_id', 'Unique id, e.g. CARD-012 (required)'],
  ['course', 'Course name, e.g. Anatomy II - Thorax (required)'],
  ['topic', 'Optional topic'],
  ['model', 'Model id, e.g. heart_v1 or kidney_v1 — see the "Structures" sheet (required)'],
  ['variant', 'Model variant id, e.g. normal, mitral_stenosis (required)'],
  ['stem_en / stem_ar', 'Case stem in English (required) and Arabic (optional)'],
  ['camera', 'anterior | posterior | left | right | superior | inferior | custom (custom uses alpha, beta, radius)'],
  ['hidden_layers', 'Comma list of layer ids hidden when the case opens, e.g. pericardium'],
  ['labels_visible', 'yes / no (labels are always off in assessment unless practice = yes)'],
  ['time_limit_min', 'Minutes, e.g. 10 (blank = no limit)'],
  ['allowed_layers', 'Comma list of layers the student may toggle (blank = all)'],
  ['feedback_level', 'none | score | full'],
  ['practice', 'yes for a non-graded practice case'],
  ['author, reviewer, version, status', 'status: draft | in_review | published | archived'],
  ['objectives', 'Semicolon-separated list'],
  ['difficulty', 'easy | medium | hard'],
  ['', ''],
  ['Questions sheet', ''],
  ['case_id', 'Must match a row in the Cases sheet'],
  ['question_id', 'Unique within the case, e.g. q1'],
  ['type', 'identify | mcq | multi | order | text'],
  ['prompt_en / prompt_ar', 'Question text in English (required) and Arabic'],
  ['options / options_ar', 'For mcq/multi/order: a=Congenital|b=Rheumatic (same keys in options_ar)'],
  ['answer', 'identify: structure id(s) or names, comma-separated (e.g. TA:mitral_valve); mcq: one key; multi: keys a, c; order: keys in correct order; text: model answer (not auto-scored)'],
  ['points', 'Number ≥ 0'],
  ['feedback_en / feedback_ar', 'Shown after submission when feedback_level = full'],
  ['match', 'identify only: any (default) or all'],
  ['partial_credit', 'multi only: yes / no'],
  ['', ''],
  ['Convert', 'npx tsx packages/core/src/cli/case-convert.ts cases.xlsx out/   (or import in the portal)'],
];

function styleHeader(ws: ExcelJS.Worksheet, widths: number[]): void {
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

/** Build a workbook in template form containing the given cases (empty list = headers only). */
export async function casesToWorkbook(cases: CaseData[], models: ModelDef[] = MODELS): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MedSim Lab';
  const ins = wb.addWorksheet('Instructions');
  INSTRUCTIONS.forEach((r) => ins.addRow(r));
  ins.getColumn(1).width = 34;
  ins.getColumn(2).width = 110;
  ins.getRow(1).font = { bold: true, size: 14 };

  const rows = casesToRows(cases);
  const cs = wb.addWorksheet('Cases');
  cs.addRow([...CASE_COLUMNS]);
  for (const r of rows.cases) cs.addRow(CASE_COLUMNS.map((c) => r[c] ?? ''));
  styleHeader(cs, CASE_COLUMNS.map((c) => (c.startsWith('stem') ? 60 : 16)));

  const qs = wb.addWorksheet('Questions');
  qs.addRow([...QUESTION_COLUMNS]);
  for (const r of rows.questions) qs.addRow(QUESTION_COLUMNS.map((c) => r[c] ?? ''));
  styleHeader(qs, QUESTION_COLUMNS.map((c) => (/prompt|feedback|options/.test(c) ? 45 : 14)));

  const st = wb.addWorksheet('Structures');
  st.addRow(['model', 'kind', 'id', 'name_en', 'name_ar', 'layer', 'ta_code']);
  for (const m of models) {
    for (const l of m.layers) st.addRow([m.id, 'layer', l.id, enOf(l.name), arOf(l.name), '', '']);
    for (const v of m.variants) st.addRow([m.id, 'variant', v.id, enOf(v.name), arOf(v.name), '', '']);
    for (const s of m.structures) st.addRow([m.id, 'structure', s.id, enOf(s.name), arOf(s.name), s.layer, s.ta_code ?? '']);
  }
  styleHeader(st, [12, 10, 30, 32, 32, 18, 14]);

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/** The example row shipped in the blank template (mirrors the PRD §10 example). */
export const TEMPLATE_EXAMPLE_CASE: CaseData = {
  case_id: 'EXAMPLE-001',
  course: 'Example course',
  topic: 'Valvular heart disease',
  model: 'heart_v1',
  variant: 'mitral_stenosis',
  stem: {
    en: 'A 45-year-old woman presents with exertional dyspnea and a history of rheumatic fever.',
    ar: 'امرأة تبلغ من العمر 45 عاماً تشكو من ضيق النفس عند الجهد ولديها تاريخ إصابة بالحمى الروماتيزمية.',
  },
  initial_view: { camera: 'anterior', hidden_layers: ['pericardium'] },
  labels_visible: false,
  time_limit_min: 10,
  feedback_level: 'score',
  questions: [
    { id: 'q1', type: 'identify', prompt: { en: 'Select the affected valve.', ar: 'اختر الصمام المصاب.' }, answer: ['TA:mitral_valve'], points: 2 },
    {
      id: 'q2',
      type: 'mcq',
      prompt: { en: 'What is the most likely etiology?', ar: 'ما السبب الأكثر ترجيحاً؟' },
      options: {
        a: { en: 'Congenital', ar: 'خلقي' },
        b: { en: 'Rheumatic', ar: 'روماتيزمي' },
        c: { en: 'Infective', ar: 'عدوائي' },
        d: { en: 'Degenerative', ar: 'تنكسي' },
      },
      answer: 'b',
      points: 1,
    },
  ],
  meta: { author: 'your.name', version: 1, status: 'draft' },
};

/** Blank template with headers, an instructions sheet and one example row. */
export async function buildTemplateWorkbook(): Promise<Uint8Array> {
  return casesToWorkbook([TEMPLATE_EXAMPLE_CASE]);
}

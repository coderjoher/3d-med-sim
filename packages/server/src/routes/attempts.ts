/** Attempts: start (keys stripped), server-side scoring, offline sync, manual grading (C-05, C-06, C-08, C-09, NFR). */
import type { FastifyInstance } from 'fastify';
import { applyFeedbackLevel, applyManualGrade, PRACTICE_CASE, scoreCase, toPlayerCase } from '@medsim/core';
import type {
  AnswerRecord, AttemptSummary, CaseData, FeedbackLevel, InteractionLog, ScoreResult, StartAttemptResponse,
  SubmitAttemptRequest, SubmitAttemptResponse, User,
} from '@medsim/core';
import { isUniqueViolation, j, type Db } from '../db/pool.js';
import { badRequest, forbidden, hasAnyRole, HttpError, me, notFound, nowIso, uid } from '../http.js';
import { getCaseHead, getCaseVersion, getModel } from '../repo.js';
import { attachStationToSession } from './sessions.js';
import type { AppCtx } from '../app.js';

export interface AttemptRow {
  id: string; org_id: string; client_attempt_id: string; student_id: string; case_id: string; case_version: number;
  model_id: string; model_version: number; session_id: string | null; station_id: string | null; status: 'started' | 'submitted';
  started_at: number; submitted_at: string | null; timed_out: boolean; needed_help: boolean;
  answers: AnswerRecord[] | null; log: InteractionLog | null; result: ScoreResult | null;
  score: number | null; max_score: number | null; percent: number | null; pending_manual: number;
}

export function toSummary(r: AttemptRow, names?: Map<string, string>): AttemptSummary {
  const s: AttemptSummary = {
    id: r.id, student_id: r.student_id, case_id: r.case_id, case_version: Number(r.case_version),
    score: Number(r.score ?? 0), max_score: Number(r.max_score ?? 0), percent: Number(r.percent ?? 0),
    pending_manual: Number(r.pending_manual ?? 0), submitted_at: r.submitted_at ?? '',
  };
  if (r.session_id) s.session_id = r.session_id;
  const n = names?.get(r.student_id);
  if (n) s.student_name = n;
  return s;
}

const isPracticeCase = (c: CaseData | undefined) => !!c?.practice;
const practiceCaseId = () => (PRACTICE_CASE as CaseData | undefined)?.case_id;

/** Practice attempts are never stored (I-03, T0-12); remember just enough to score them. */
const practice = new Map<string, CaseData>();
function rememberPractice(id: string, c: CaseData) {
  practice.set(id, c);
  if (practice.size > 1000) practice.delete(practice.keys().next().value as string);
}

function feedbackLevel(c: CaseData): FeedbackLevel {
  return c.feedback_level ?? 'score';
}

function shape(result: ScoreResult, level: FeedbackLevel): SubmitAttemptResponse['result'] {
  return applyFeedbackLevel(result, level) as SubmitAttemptResponse['result'];
}

function neededHelp(log: InteractionLog | undefined): boolean {
  return !!log?.events?.some((e) => e.data && (e.data.help === true || e.data.by === 'proctor'));
}

/** Resolve which case (and version) a start request targets. */
async function resolveCase(db: Db, org: string, caseId: string): Promise<{ data: CaseData; version: number; modelVersion: number; modelId: string } | { practice: CaseData }> {
  const pid = practiceCaseId();
  const head = await db.one<{ id: string }>(`SELECT id FROM cases WHERE org_id = $1 AND id = $2`, [org, caseId]);
  if (!head && pid && caseId === pid) return { practice: PRACTICE_CASE };
  const h = await getCaseHead(db, org, caseId);
  if (h.published_version == null) throw notFound('Case not found');
  const v = await getCaseVersion(db, org, h.id, h.published_version);
  if (isPracticeCase(v.data)) return { practice: v.data };
  // Attempts record the model version actually served now (registry), falling back to the version the case was validated with.
  const model = await getModel(db, org, v.model_id);
  return { data: v.data, version: Number(v.version), modelId: v.model_id, modelVersion: model?.version ?? Number(v.model_version) };
}

async function finalize(db: Db, row: AttemptRow, body: SubmitAttemptRequest, caseData: CaseData): Promise<AttemptRow> {
  if (!Array.isArray(body.answers)) throw badRequest('answers must be an array');
  const result = scoreCase(caseData, body.answers);
  const log = body.log ?? null;
  await db.exec(
    `UPDATE attempts SET status = 'submitted', submitted_at = $1, timed_out = $2, needed_help = $3, answers = $4::jsonb, log = $5::jsonb,
       result = $6::jsonb, score = $7, max_score = $8, percent = $9, pending_manual = $10
     WHERE org_id = $11 AND id = $12 AND status = 'started'`,
    [nowIso(), !!body.timed_out, row.needed_help || neededHelp(log ?? undefined), j(body.answers), j(log), j(result),
      result.score, result.max_score, result.percent, result.pending_manual, row.org_id, row.id],
  );
  return (await db.one<AttemptRow>(`SELECT * FROM attempts WHERE org_id = $1 AND id = $2`, [row.org_id, row.id]))!;
}

async function insertAttempt(
  db: Db, user: User,
  a: { client_attempt_id: string; case_id: string; case_version: number; model_id: string; model_version: number; session_id?: string; station_id?: string; started_at: number },
): Promise<AttemptRow> {
  const id = uid();
  try {
    await db.exec(
      `INSERT INTO attempts (id, org_id, client_attempt_id, student_id, case_id, case_version, model_id, model_version, session_id, station_id, status, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'started', $11)`,
      [id, user.org_id, a.client_attempt_id, user.id, a.case_id, a.case_version, a.model_id, a.model_version, a.session_id ?? null, a.station_id ?? null, a.started_at],
    );
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  return (await db.one<AttemptRow>(`SELECT * FROM attempts WHERE org_id = $1 AND client_attempt_id = $2`, [user.org_id, a.client_attempt_id]))!;
}

function assertOwner(u: User, row: AttemptRow) {
  if (row.student_id !== u.id && !hasAnyRole(u, ['proctor', 'author', 'reviewer'])) throw notFound('Attempt not found');
}

export async function attemptRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db, auth } = ctx;

  app.post<{ Body: { client_attempt_id: string; session_id?: string; case_id: string; station_id?: string } }>(
    '/api/attempts/start',
    { preHandler: auth('student') },
    async (req): Promise<StartAttemptResponse> => {
      const u = me(req);
      const b = req.body ?? ({} as { client_attempt_id: string; case_id: string });
      if (!b.client_attempt_id || !b.case_id) throw badRequest('client_attempt_id and case_id are required');
      const startedAt = Date.now();
      const existing = await db.one<AttemptRow>(`SELECT * FROM attempts WHERE org_id = $1 AND client_attempt_id = $2`, [u.org_id, b.client_attempt_id]);
      if (existing) {
        if (existing.student_id !== u.id) throw new HttpError(409, 'client_attempt_id already used');
        const v = await getCaseVersion(db, u.org_id, existing.case_id, existing.case_version);
        return { attempt_id: existing.id, case: toPlayerCase(v.data), case_version: Number(existing.case_version), model_version: Number(existing.model_version), started_at: Number(existing.started_at) };
      }
      const target = await resolveCase(db, u.org_id, b.case_id);
      if ('practice' in target) {
        const id = `practice-${uid()}`;
        rememberPractice(id, target.practice);
        const model = await getModel(db, u.org_id, target.practice.model);
        return { attempt_id: id, case: toPlayerCase(target.practice), case_version: target.practice.meta?.version ?? 1, model_version: model?.version ?? 1, started_at: startedAt };
      }
      if (b.session_id) {
        const s = await db.one<{ id: string }>(`SELECT id FROM sessions WHERE org_id = $1 AND id = $2`, [u.org_id, b.session_id]);
        if (!s) throw notFound('Session not found');
      }
      const row = await insertAttempt(db, u, {
        client_attempt_id: b.client_attempt_id, case_id: b.case_id, case_version: target.version, model_id: target.modelId,
        model_version: target.modelVersion, session_id: b.session_id, station_id: b.station_id, started_at: startedAt,
      });
      if (b.station_id) await attachStationToSession(db, u.org_id, b.station_id, b.session_id);
      return { attempt_id: row.id, case: toPlayerCase(target.data), case_version: target.version, model_version: target.modelVersion, started_at: Number(row.started_at) };
    },
  );

  app.post<{ Params: { id: string }; Body: SubmitAttemptRequest }>('/api/attempts/:id/submit', { preHandler: auth() }, async (req): Promise<SubmitAttemptResponse> => {
    const u = me(req);
    const body = req.body ?? ({} as SubmitAttemptRequest);
    if (req.params.id.startsWith('practice-')) {
      const c = practice.get(req.params.id) ?? PRACTICE_CASE;
      const result = scoreCase(c, body.answers ?? []);
      return { attempt_id: req.params.id, feedback_level: 'full', result: shape(result, 'full') };
    }
    let row = await db.one<AttemptRow>(`SELECT * FROM attempts WHERE org_id = $1 AND id = $2`, [u.org_id, req.params.id]);
    if (!row) throw notFound('Attempt not found');
    if (row.student_id !== u.id) throw forbidden('Not your attempt');
    if (body.client_attempt_id && body.client_attempt_id !== row.client_attempt_id) throw badRequest('client_attempt_id does not match this attempt');
    const v = await getCaseVersion(db, u.org_id, row.case_id, row.case_version);
    if (row.status !== 'submitted') row = await finalize(db, row, body, v.data);
    const level = feedbackLevel(v.data);
    return { attempt_id: row.id, feedback_level: level, result: shape(row.result!, level) };
  });

  /** Offline queue flush (NFR reliability). Idempotent on client_attempt_id. Returns synced client_attempt_ids. */
  app.post<{ Body: { items: Array<SubmitAttemptRequest & { case_id: string; case_version: number; session_id?: string; station_id?: string; started_at: number }> } }>(
    '/api/attempts/sync',
    { preHandler: auth('student') },
    async (req) => {
      const u = me(req);
      const items = req.body?.items;
      if (!Array.isArray(items)) throw badRequest('items must be an array');
      const synced: string[] = [];
      const failed: Array<{ client_attempt_id: string; error: string }> = [];
      for (const it of items) {
        try {
          if (!it?.client_attempt_id || !it.case_id) throw badRequest('client_attempt_id and case_id are required');
          let row = await db.one<AttemptRow>(`SELECT * FROM attempts WHERE org_id = $1 AND client_attempt_id = $2`, [u.org_id, it.client_attempt_id]);
          if (row && row.student_id !== u.id) throw new HttpError(409, 'client_attempt_id already used');
          if (!row) {
            const head = await db.one<{ id: string }>(`SELECT id FROM cases WHERE org_id = $1 AND id = $2`, [u.org_id, it.case_id]);
            if (!head && it.case_id === practiceCaseId()) { synced.push(it.client_attempt_id); continue; }
            const v = await getCaseVersion(db, u.org_id, it.case_id, Number(it.case_version ?? 0));
            if (!v.published_at) throw badRequest('Case version was never published');
            if (isPracticeCase(v.data)) { synced.push(it.client_attempt_id); continue; }
            let modelVersion = Number(it.log?.model_version ?? 0);
            if (!modelVersion || !(await getModel(db, u.org_id, v.model_id, modelVersion)))
              modelVersion = (await getModel(db, u.org_id, v.model_id))?.version ?? Number(v.model_version);
            row = await insertAttempt(db, u, {
              client_attempt_id: it.client_attempt_id, case_id: it.case_id, case_version: Number(v.version), model_id: v.model_id,
              model_version: modelVersion, session_id: it.session_id, station_id: it.station_id, started_at: Number(it.started_at) || Date.now(),
            });
          }
          if (row.status !== 'submitted') {
            const v = await getCaseVersion(db, u.org_id, row.case_id, row.case_version);
            await finalize(db, row, it, v.data);
          }
          synced.push(it.client_attempt_id);
        } catch (e) {
          failed.push({ client_attempt_id: String(it?.client_attempt_id ?? ''), error: (e as Error).message });
        }
      }
      return { synced, failed };
    },
  );

  app.get<{ Querystring: { student_id?: string; case_id?: string; course_id?: string; session_id?: string } }>('/api/attempts', { preHandler: auth() }, async (req) => {
    const u = me(req);
    const staff = hasAnyRole(u, ['proctor', 'author', 'reviewer']);
    const studentId = staff ? req.query.student_id : u.id;
    let rows = await db.many<AttemptRow>(`SELECT * FROM attempts WHERE org_id = $1 AND status = 'submitted' ORDER BY submitted_at`, [u.org_id]);
    if (studentId) rows = rows.filter((r) => r.student_id === studentId);
    if (req.query.case_id) rows = rows.filter((r) => r.case_id === req.query.case_id);
    if (req.query.session_id) rows = rows.filter((r) => r.session_id === req.query.session_id);
    if (req.query.course_id) {
      const ids = new Set((await db.many<{ id: string }>(`SELECT id FROM cases WHERE org_id = $1 AND course_id = $2`, [u.org_id, req.query.course_id])).map((c) => c.id));
      rows = rows.filter((r) => ids.has(r.case_id));
    }
    const names = await userNames(db, u.org_id);
    if (staff) return rows.map((r) => toSummary(r, names));
    // Students: score fields are omitted for cases whose feedback level is 'none' (C-08).
    const levels = new Map<string, FeedbackLevel>();
    const out: AttemptSummary[] = [];
    for (const r of rows) {
      const k = `${r.case_id}@${r.case_version}`;
      if (!levels.has(k)) levels.set(k, feedbackLevel((await getCaseVersion(db, u.org_id, r.case_id, r.case_version)).data));
      const s = toSummary(r, names);
      if (levels.get(k) === 'none') {
        const { score: _s, max_score: _m, percent: _p, ...rest } = s;
        out.push(rest as AttemptSummary);
      } else out.push(s);
    }
    return out;
  });

  /** Full attempt record incl. answers, log and result (extra route). */
  app.get<{ Params: { id: string } }>('/api/attempts/:id', { preHandler: auth() }, async (req) => {
    const u = me(req);
    const row = await db.one<AttemptRow>(`SELECT * FROM attempts WHERE org_id = $1 AND id = $2`, [u.org_id, req.params.id]);
    if (!row) throw notFound('Attempt not found');
    assertOwner(u, row);
    const staff = hasAnyRole(u, ['proctor', 'author', 'reviewer']);
    let result: unknown = row.result;
    if (!staff && row.result) {
      // Students only ever see what the case's feedback level allows (C-08).
      const v = await getCaseVersion(db, u.org_id, row.case_id, row.case_version);
      result = shape(row.result, feedbackLevel(v.data));
    }
    const base = toSummary(row, await userNames(db, u.org_id));
    const summary = staff ? base : { ...base, ...(result && (result as { score?: number }).score === undefined ? { score: undefined, percent: undefined, max_score: undefined } : {}) };
    return { ...summary, client_attempt_id: row.client_attempt_id, status: row.status, model_id: row.model_id,
      model_version: Number(row.model_version), station_id: row.station_id ?? undefined, started_at: Number(row.started_at), timed_out: row.timed_out,
      answers: row.answers ?? [], log: row.log, result };
  });

  // --- manual grading (C-05) ----------------------------------------------
  app.get('/api/grading/pending', { preHandler: auth('author', 'reviewer', 'proctor') }, async (req) => {
    const org = me(req).org_id;
    const rows = await db.many<AttemptRow>(`SELECT * FROM attempts WHERE org_id = $1 AND status = 'submitted' AND pending_manual > 0 ORDER BY submitted_at`, [org]);
    const out: Array<{ attempt_id: string; question_id: string; prompt: unknown; response: unknown; student_id: string }> = [];
    for (const r of rows) {
      const v = await getCaseVersion(db, org, r.case_id, r.case_version);
      for (const q of r.result?.questions ?? []) {
        if (!q.pending_manual) continue;
        const cq = v.data.questions.find((x) => x.id === q.question_id);
        out.push({ attempt_id: r.id, question_id: q.question_id, prompt: cq?.prompt ?? '', response: q.response ?? '', student_id: r.student_id });
      }
    }
    return out;
  });

  app.post<{ Params: { attemptId: string; questionId: string }; Body: { points: number } }>(
    '/api/grading/:attemptId/:questionId',
    { preHandler: auth('author', 'reviewer', 'proctor') },
    async (req) => {
      const u = me(req);
      const points = Number(req.body?.points);
      if (!Number.isFinite(points) || points < 0) throw badRequest('points must be a number >= 0');
      const row = await db.one<AttemptRow>(`SELECT * FROM attempts WHERE org_id = $1 AND id = $2`, [u.org_id, req.params.attemptId]);
      if (!row || row.status !== 'submitted' || !row.result) throw notFound('Attempt not found');
      const q = row.result.questions.find((x) => x.question_id === req.params.questionId);
      if (!q) throw notFound('Question not found');
      if (points > q.points_possible) throw badRequest(`points must be <= ${q.points_possible}`);
      const result = applyManualGrade(row.result, req.params.questionId, points);
      await db.exec(`UPDATE attempts SET result = $1::jsonb, score = $2, max_score = $3, percent = $4, pending_manual = $5 WHERE org_id = $6 AND id = $7`, [
        j(result), result.score, result.max_score, result.percent, result.pending_manual, u.org_id, row.id,
      ]);
      await db.exec(`INSERT INTO manual_grades (id, org_id, attempt_id, question_id, points, grader_id, graded_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
        uid(), u.org_id, row.id, req.params.questionId, points, u.id, nowIso(),
      ]);
      const updated = (await db.one<AttemptRow>(`SELECT * FROM attempts WHERE org_id = $1 AND id = $2`, [u.org_id, row.id]))!;
      return toSummary(updated, await userNames(db, u.org_id));
    },
  );
}

export async function userNames(db: Db, org: string): Promise<Map<string, string>> {
  const rows = await db.many<{ id: string; display_name: string }>(`SELECT id, display_name FROM users WHERE org_id = $1`, [org]);
  return new Map(rows.map((r) => [r.id, r.display_name]));
}

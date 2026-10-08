/** Reports (R-01..R-06), success metrics (§17), SUS (T2-10) and exam scores. */
import type { FastifyInstance } from 'fastify';
import PDFDocument from 'pdfkit';
import {
  cohortComparison, itemAnalysis, pearson, questionAnalytics, structureHeatmap, summarizeLog, susScore, toCsv,
} from '@medsim/core';
import type { AttemptForAnalytics, CaseData, StudentCourseResult, SuccessMetrics } from '@medsim/core';
import { j, type Db } from '../db/pool.js';
import { badRequest, me, notFound, nowIso, uid } from '../http.js';
import type { AppCtx } from '../app.js';
import type { AttemptRow } from './attempts.js';

const STAFF = ['author', 'reviewer', 'proctor'] as const;

interface Ctx { org: string; courseId?: string; caseId?: string }

async function caseIdsForCourse(db: Db, org: string, courseId: string): Promise<Set<string>> {
  const c = await db.one(`SELECT id FROM courses WHERE org_id = $1 AND id = $2`, [org, courseId]);
  if (!c) throw notFound('Course not found');
  return new Set((await db.many<{ id: string }>(`SELECT id FROM cases WHERE org_id = $1 AND course_id = $2`, [org, courseId])).map((r) => r.id));
}

async function submittedAttempts(db: Db, q: Ctx): Promise<AttemptRow[]> {
  let rows = await db.many<AttemptRow>(`SELECT * FROM attempts WHERE org_id = $1 AND status = 'submitted' ORDER BY submitted_at`, [q.org]);
  if (q.caseId) rows = rows.filter((r) => r.case_id === q.caseId);
  if (q.courseId) {
    const ids = await caseIdsForCourse(db, q.org, q.courseId);
    rows = rows.filter((r) => ids.has(r.case_id));
  }
  return rows;
}

interface StudentInfo { id: string; display_name: string; username: string; cohort_id: string | null }

async function students(db: Db, org: string) {
  const users = await db.many<StudentInfo>(`SELECT id, display_name, username, cohort_id FROM users WHERE org_id = $1`, [org]);
  const cohorts = await db.many<{ id: string; name: string; year: number }>(`SELECT id, name, year FROM cohorts WHERE org_id = $1`, [org]);
  return { users: new Map(users.map((u) => [u.id, u])), cohorts: new Map(cohorts.map((c) => [c.id, { ...c, year: Number(c.year) }])) };
}

function safeSummary(r: AttemptRow) {
  try {
    return r.log && Array.isArray(r.log.events) ? summarizeLog(r.log) : undefined;
  } catch {
    return undefined;
  }
}

async function forAnalytics(db: Db, org: string, rows: AttemptRow[]): Promise<AttemptForAnalytics[]> {
  const { users, cohorts } = await students(db, org);
  return rows.map((r) => {
    const u = users.get(r.student_id);
    const cohort = u?.cohort_id ? cohorts.get(u.cohort_id) : undefined;
    const sum = safeSummary(r);
    const a: AttemptForAnalytics = {
      attempt_id: r.id, student_id: r.student_id, case_id: r.case_id, case_version: Number(r.case_version),
      score: Number(r.score ?? 0), max_score: Number(r.max_score ?? 0), questions: r.result?.questions ?? [],
      needed_help: !!r.needed_help,
      used_fallback: !!sum?.input_modes?.some((m) => m !== 'gesture'),
    };
    if (cohort) { a.cohort_id = cohort.id; a.year = cohort.year; }
    if (sum) a.time_per_question_ms = sum.time_per_question_ms;
    return a;
  });
}

/** Case data for the exact versions the attempts reference (answer keys for heatmaps). */
async function versionsFor(db: Db, org: string, rows: AttemptRow[]): Promise<CaseData[]> {
  const seen = new Map<string, CaseData>();
  for (const r of rows) {
    const k = `${r.case_id}@${r.case_version}`;
    if (seen.has(k)) continue;
    const v = await db.one<{ data: CaseData }>(`SELECT data FROM case_versions WHERE org_id = $1 AND case_id = $2 AND version = $3`, [org, r.case_id, r.case_version]);
    if (v) seen.set(k, v.data);
  }
  return [...seen.values()];
}

async function studentResults(db: Db, org: string, courseId?: string): Promise<StudentCourseResult[]> {
  const heads = courseId
    ? await db.many<{ id: string; published_version: number | null }>(`SELECT id, published_version FROM cases WHERE org_id = $1 AND course_id = $2 ORDER BY id`, [org, courseId])
    : await db.many<{ id: string; published_version: number | null }>(`SELECT id, published_version FROM cases WHERE org_id = $1 ORDER BY id`, [org]);
  if (courseId && !(await db.one(`SELECT id FROM courses WHERE org_id = $1 AND id = $2`, [org, courseId]))) throw notFound('Course not found');
  const caseIds = heads.map((h) => h.id);
  const caseSet = new Set(caseIds);
  const rows = (await submittedAttempts(db, { org })).filter((r) => caseSet.has(r.case_id));
  const { users } = await students(db, org);
  // Students: those enrolled via cohort in the course, plus anyone with attempts.
  const ids = new Set(rows.map((r) => r.student_id));
  const allUsers = await db.many<{ id: string; roles: string[]; cohort_id: string | null }>(`SELECT id, roles, cohort_id FROM users WHERE org_id = $1`, [org]);
  const enrolled = courseId
    ? new Set((await db.many<{ cohort_id: string }>(`SELECT cohort_id FROM enrolments WHERE org_id = $1 AND course_id = $2`, [org, courseId])).map((e) => e.cohort_id))
    : undefined;
  for (const u of allUsers) if (u.roles.includes('student') && u.cohort_id && (!enrolled || enrolled.has(u.cohort_id))) ids.add(u.id);
  const gradedCases = heads.filter((h) => h.published_version != null).map((h) => h.id);
  const out: StudentCourseResult[] = [];
  for (const sid of ids) {
    const u = users.get(sid);
    const mine = rows.filter((r) => r.student_id === sid);
    const cases = [...new Set([...gradedCases, ...mine.map((r) => r.case_id)])].map((cid) => {
      const as = mine.filter((r) => r.case_id === cid);
      return { case_id: cid, best_percent: as.length ? Math.max(...as.map((r) => Number(r.percent ?? 0))) : 0, attempts: as.length };
    });
    const course_percent = cases.length ? cases.reduce((s, c) => s + c.best_percent, 0) / cases.length : 0;
    const res: StudentCourseResult = { student_id: sid, student_name: u?.display_name ?? sid, cases, course_percent: Math.round(course_percent * 100) / 100 };
    if (u?.cohort_id) res.cohort_id = u.cohort_id;
    out.push(res);
  }
  return out.sort((a, b) => a.student_name.localeCompare(b.student_name));
}

async function exportRows(db: Db, org: string, courseId?: string) {
  const rows = await submittedAttempts(db, { org, courseId });
  const { users, cohorts } = await students(db, org);
  return rows.map((r) => {
    const u = users.get(r.student_id);
    return {
      student: u?.display_name ?? r.student_id,
      username: u?.username ?? '',
      cohort: u?.cohort_id ? (cohorts.get(u.cohort_id)?.name ?? '') : '',
      case_id: r.case_id,
      case_version: Number(r.case_version),
      model_version: Number(r.model_version),
      score: Number(r.score ?? 0),
      max_score: Number(r.max_score ?? 0),
      percent: Number(r.percent ?? 0),
      pending_manual: Number(r.pending_manual ?? 0),
      submitted_at: r.submitted_at ?? '',
    };
  });
}

function pdfBuffer(title: string, rows: Awaited<ReturnType<typeof exportRows>>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text(title);
    doc.fontSize(9).fillColor('#555').text(`Generated ${nowIso()}`).moveDown();
    const cols = [{ h: 'Student', w: 170 }, { h: 'Case', w: 170 }, { h: 'Score', w: 80 }, { h: 'Percent', w: 80 }];
    const row = (vals: string[], bold = false) => {
      if (doc.y > 780) doc.addPage();
      const y = doc.y;
      let x = 40;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#000');
      vals.forEach((v, i) => {
        doc.text(v, x, y, { width: cols[i]!.w - 6, lineBreak: false, ellipsis: true });
        x += cols[i]!.w;
      });
      doc.moveTo(40, y + 14).lineTo(540, y + 14).strokeColor('#ccc').lineWidth(0.5).stroke();
      doc.x = 40;
      doc.y = y + 18;
    };
    row(cols.map((c) => c.h), true);
    for (const r of rows) row([r.student, `${r.case_id} (v${r.case_version})`, `${r.score} / ${r.max_score}`, `${r.percent.toFixed(1)} %`]);
    if (!rows.length) doc.font('Helvetica').text('No submitted attempts.');
    doc.end();
  });
}

export async function reportRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db, auth } = ctx;
  const staff = auth(...STAFF);

  app.get<{ Querystring: { course_id?: string } }>('/api/reports/students', { preHandler: staff }, async (req) =>
    studentResults(db, me(req).org_id, req.query.course_id),
  );

  app.get<{ Querystring: { case_id?: string; course_id?: string } }>('/api/reports/questions', { preHandler: staff }, async (req) => {
    const org = me(req).org_id;
    if (!req.query.case_id) throw badRequest('case_id is required');
    const rows = await submittedAttempts(db, { org, caseId: req.query.case_id });
    return questionAnalytics(await forAnalytics(db, org, rows));
  });

  app.get<{ Querystring: { case_id?: string; course_id?: string } }>('/api/reports/heatmap', { preHandler: staff }, async (req) => {
    const org = me(req).org_id;
    if (!req.query.case_id && !req.query.course_id) throw badRequest('case_id or course_id is required');
    const rows = await submittedAttempts(db, { org, caseId: req.query.case_id, courseId: req.query.course_id });
    return structureHeatmap(await forAnalytics(db, org, rows), await versionsFor(db, org, rows));
  });

  /** Groups are labelled with the cohort name (by=cohort) or the year (by=year). */
  app.get<{ Querystring: { course_id?: string; case_id?: string; by?: 'cohort' | 'year' } }>('/api/reports/cohorts', { preHandler: staff }, async (req) => {
    const org = me(req).org_id;
    const by = req.query.by === 'year' ? 'year' : 'cohort';
    const rows = await submittedAttempts(db, { org, courseId: req.query.course_id, caseId: req.query.case_id });
    const stats = cohortComparison(await forAnalytics(db, org, rows), by);
    if (by === 'year') return stats;
    const { cohorts } = await students(db, org);
    return stats.map((s) => ({ ...s, group: cohorts.get(s.group)?.name ?? s.group }));
  });

  app.get<{ Querystring: { case_id?: string } }>('/api/reports/items', { preHandler: staff }, async (req) => {
    const org = me(req).org_id;
    if (!req.query.case_id) throw badRequest('case_id is required');
    const rows = await submittedAttempts(db, { org, caseId: req.query.case_id });
    return itemAnalysis(await forAnalytics(db, org, rows));
  });

  app.get<{ Querystring: { course_id?: string } }>('/api/reports/export.csv', { preHandler: staff }, async (req, reply) => {
    const rows = await exportRows(db, me(req).org_id, req.query.course_id);
    const cols = ['student', 'username', 'cohort', 'case_id', 'case_version', 'model_version', 'score', 'max_score', 'percent', 'pending_manual', 'submitted_at'];
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="medsim-results.csv"');
    return toCsv(rows, cols);
  });

  app.get<{ Querystring: { course_id?: string } }>('/api/reports/export.pdf', { preHandler: staff }, async (req, reply) => {
    const org = me(req).org_id;
    let title = 'MedSim Lab — Results';
    if (req.query.course_id) {
      const c = await db.one<{ code: string; name: string }>(`SELECT code, name FROM courses WHERE org_id = $1 AND id = $2`, [org, req.query.course_id]);
      if (!c) throw notFound('Course not found');
      title += ` — ${c.code} ${c.name}`;
    }
    const buf = await pdfBuffer(title, await exportRows(db, org, req.query.course_id));
    reply.header('content-type', 'application/pdf').header('content-disposition', 'attachment; filename="medsim-results.pdf"');
    return buf;
  });

  app.get<{ Querystring: { course_id?: string } }>('/api/reports/metrics', { preHandler: auth('author', 'reviewer', 'proctor') }, async (req): Promise<SuccessMetrics> => {
    const org = me(req).org_id;
    const courseId = req.query.course_id;
    const caseIds = courseId ? await caseIdsForCourse(db, org, courseId) : undefined;
    const rows = await submittedAttempts(db, { org, courseId });
    const an = await forAnalytics(db, org, rows);
    const rate = (k: (a: AttemptForAnalytics, r: AttemptRow) => boolean) => (an.length ? an.filter((a, i) => k(a, rows[i]!)).length / an.length : null);

    const heads = (await db.many<{ id: string; created_at: string; first_published_at: string | null }>(`SELECT id, created_at, first_published_at FROM cases WHERE org_id = $1`, [org]))
      .filter((h) => !caseIds || caseIds.has(h.id));
    const pubTimes = heads.filter((h) => h.first_published_at).map((h) => (Date.parse(h.first_published_at!) - Date.parse(h.created_at)) / 3_600_000);
    const versions = (await db.many<{ case_id: string; author_id: string }>(`SELECT case_id, author_id FROM case_versions WHERE org_id = $1`, [org]))
      .filter((v) => !caseIds || caseIds.has(v.case_id));
    const sessions = (await db.many<{ case_ids: string[] }>(`SELECT case_ids FROM sessions WHERE org_id = $1`, [org]))
      .filter((s) => !caseIds || s.case_ids.some((c) => caseIds.has(c)));
    const sus = await db.many<{ score: number }>(`SELECT score FROM sus_responses WHERE org_id = $1`, [org]);

    let corr: number | null = null;
    if (courseId) {
      const exams = await db.many<{ student_id: string; percent: number }>(`SELECT student_id, percent FROM exam_scores WHERE org_id = $1 AND course_id = $2`, [org, courseId]);
      const results = new Map((await studentResults(db, org, courseId)).filter((r) => r.cases.some((c) => c.attempts > 0)).map((r) => [r.student_id, r.course_percent]));
      const pairs = exams.filter((e) => results.has(e.student_id));
      corr = pearson(pairs.map((p) => results.get(p.student_id)!), pairs.map((p) => Number(p.percent)));
    }
    return {
      completion_without_help_rate: rate((a, r) => !a.needed_help && !r.timed_out),
      fallback_usage_rate: rate((a) => !!a.used_fallback),
      avg_time_to_publish_hours: pubTimes.length ? pubTimes.reduce((s, x) => s + x, 0) / pubTimes.length : null,
      active_authors: new Set(versions.map((v) => v.author_id)).size,
      sessions: sessions.length,
      sus_mean: sus.length ? sus.reduce((s, x) => s + Number(x.score), 0) / sus.length : null,
      score_exam_correlation: corr,
    };
  });

  // --- SUS (T2-10) -------------------------------------------------------
  app.post<{ Body: { answers: number[]; lang?: 'en' | 'ar' } }>('/api/sus', { preHandler: auth() }, async (req) => {
    const u = me(req);
    let score: number;
    try {
      score = susScore(req.body?.answers);
    } catch (e) {
      throw badRequest((e as Error).message || 'Invalid SUS answers');
    }
    await db.exec(`INSERT INTO sus_responses (id, org_id, user_id, answers, lang, score, created_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`, [
      uid(), u.org_id, u.id, j(req.body.answers), req.body.lang ?? null, score, nowIso(),
    ]);
    return { score };
  });

  app.get('/api/sus/summary', { preHandler: auth('author', 'reviewer', 'proctor') }, async (req) => {
    const rows = await db.many<{ score: number }>(`SELECT score FROM sus_responses WHERE org_id = $1`, [me(req).org_id]);
    return { n: rows.length, mean: rows.length ? rows.reduce((s, r) => s + Number(r.score), 0) / rows.length : null };
  });

  // --- exam scores (for the score↔exam correlation metric) -----------------
  app.post<{ Body: { rows: Array<{ student_id: string; course_id: string; percent: number }> } }>('/api/exam-scores', { preHandler: auth('admin') }, async (req) => {
    const org = me(req).org_id;
    const rows = req.body?.rows;
    if (!Array.isArray(rows)) throw badRequest('rows must be an array');
    let imported = 0;
    for (const r of rows) {
      const pct = Number(r?.percent);
      if (!r?.student_id || !r.course_id || !Number.isFinite(pct)) throw badRequest('each row needs student_id, course_id and numeric percent');
      if (!(await db.one(`SELECT id FROM users WHERE org_id = $1 AND id = $2`, [org, r.student_id]))) throw badRequest(`Unknown student ${r.student_id}`);
      if (!(await db.one(`SELECT id FROM courses WHERE org_id = $1 AND id = $2`, [org, r.course_id]))) throw badRequest(`Unknown course ${r.course_id}`);
      await db.exec(`DELETE FROM exam_scores WHERE org_id = $1 AND student_id = $2 AND course_id = $3`, [org, r.student_id, r.course_id]);
      await db.exec(`INSERT INTO exam_scores (org_id, student_id, course_id, percent) VALUES ($1, $2, $3, $4)`, [org, r.student_id, r.course_id, pct]);
      imported++;
    }
    return { imported };
  });
}

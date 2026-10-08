/** Model registry (§11) and case authoring workflow (A-02, A-04, A-05, A-06, A-01 import). */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { toPlayerCase } from '@medsim/core';
import type { CaseData, CaseRecord, CaseStatus, ModelDef } from '@medsim/core';
import { buildTemplateWorkbook, convertCsv, convertWorkbook, type ConversionError } from '@medsim/core/spreadsheet';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Locate content/templates/case-template.xlsx (repo root) from src, dist or cwd. */
function templatePath(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.CASE_TEMPLATE_PATH,
    resolve(here, '../../../../content/templates/case-template.xlsx'),
    resolve(here, '../../../content/templates/case-template.xlsx'),
    resolve(process.cwd(), 'content/templates/case-template.xlsx'),
    resolve(process.cwd(), '../../content/templates/case-template.xlsx'),
  ];
  return candidates.find((p): p is string => !!p && existsSync(p));
}
import { j } from '../db/pool.js';
import { badRequest, forbidden, hasAnyRole, HttpError, me, notFound, nowIso } from '../http.js';
import {
  getCaseHead, getCaseVersion, getModel, insertCase, insertModelVersion, listCaseHeads, listModels, signOffModel,
  toCaseRecord, validateForOrg, type CaseHeadRow, type CaseVersionRow,
} from '../repo.js';
import type { AppCtx } from '../app.js';

/** Authors and reviewers (and admins) see full case data incl. keys; everyone else only published, keys stripped. */
const canSeeKeys = (req: FastifyRequest) => hasAnyRole(me(req), ['author', 'reviewer']);

function stripped(rec: CaseRecord): CaseRecord {
  return { ...rec, data: toPlayerCase(rec.data) as unknown as CaseData };
}

export async function caseRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db, auth } = ctx;

  // --- models --------------------------------------------------------------
  app.get('/api/models', { preHandler: auth() }, async (req) => listModels(db, me(req).org_id));

  app.get<{ Params: { id: string }; Querystring: { version?: string } }>('/api/models/:id', { preHandler: auth() }, async (req) => {
    const m = await getModel(db, me(req).org_id, req.params.id, req.query.version ? Number(req.query.version) : undefined);
    if (!m) throw notFound('Model not found');
    return m;
  });

  /** Register a new model version (admin). Extra route, not in api.ts. */
  app.post<{ Body: { model: ModelDef } }>('/api/models', { preHandler: auth('admin') }, async (req, reply) => {
    const m = req.body?.model;
    if (!m || !m.id || !Array.isArray(m.structures) || !Array.isArray(m.layers) || !Array.isArray(m.variants))
      throw badRequest('model with id, layers, structures and variants is required');
    const org = me(req).org_id;
    const cur = await getModel(db, org, m.id);
    const { sign_off: _ignored, ...rest } = m;
    reply.code(201);
    return insertModelVersion(db, org, rest as ModelDef, (cur?.version ?? 0) + 1);
  });

  app.post<{ Params: { id: string }; Body: { notes?: string } }>('/api/models/:id/sign-off', { preHandler: auth('reviewer') }, async (req) => {
    const u = me(req);
    return signOffModel(db, u.org_id, req.params.id, u.display_name || u.username, req.body?.notes);
  });

  /** A-01 template download (public; falls back to generating it). */
  app.get('/api/templates/case-template.xlsx', async (_req, reply) => {
    const p = templatePath();
    const buf = p ? readFileSync(p) : Buffer.from(await buildTemplateWorkbook());
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', 'attachment; filename="case-template.xlsx"');
    return buf;
  });

  // --- cases ---------------------------------------------------------------
  app.get<{ Querystring: { course_id?: string; status?: CaseStatus } }>('/api/cases', { preHandler: auth() }, async (req) => {
    const org = me(req).org_id;
    const heads = await listCaseHeads(db, org, req.query.course_id);
    const full = canSeeKeys(req);
    const out: CaseRecord[] = [];
    for (const h of heads) {
      if (full) {
        const rec = toCaseRecord(h, await getCaseVersion(db, org, h.id, h.latest_version));
        if (!req.query.status || rec.status === req.query.status) out.push(rec);
      } else if (h.published_version != null) {
        if (req.query.status && req.query.status !== 'published') continue;
        const rec = toCaseRecord(h, await getCaseVersion(db, org, h.id, h.published_version));
        out.push(stripped({ ...rec, status: 'published' }));
      }
    }
    return out;
  });

  app.get<{ Params: { id: string }; Querystring: { version?: string } }>('/api/cases/:id', { preHandler: auth() }, async (req) => {
    const org = me(req).org_id;
    const h = await getCaseHead(db, org, req.params.id);
    if (!canSeeKeys(req)) {
      if (h.published_version == null) throw notFound('Case not found');
      return stripped({ ...toCaseRecord(h, await getCaseVersion(db, org, h.id, h.published_version)), status: 'published' });
    }
    const v = req.query.version ? Number(req.query.version) : h.latest_version;
    return toCaseRecord(h, await getCaseVersion(db, org, h.id, v));
  });

  app.get<{ Params: { id: string } }>('/api/cases/:id/versions', { preHandler: auth('author', 'reviewer') }, async (req) => {
    const org = me(req).org_id;
    const h = await getCaseHead(db, org, req.params.id);
    const rows = await db.many<CaseVersionRow>(`SELECT * FROM case_versions WHERE org_id = $1 AND case_id = $2 ORDER BY version`, [org, h.id]);
    return rows.map((v) => toCaseRecord(h, v));
  });

  app.get<{ Params: { id: string }; Querystring: { version?: string } }>(
    '/api/cases/:id/preview',
    { preHandler: auth('author', 'reviewer') },
    async (req) => {
      const org = me(req).org_id;
      const h = await getCaseHead(db, org, req.params.id);
      const v = await getCaseVersion(db, org, h.id, req.query.version ? Number(req.query.version) : h.latest_version);
      return toPlayerCase(v.data);
    },
  );

  app.post<{ Body: { course_id: string; data: CaseData } }>('/api/cases', { preHandler: auth('author') }, async (req, reply) => {
    const u = me(req);
    const { course_id, data } = req.body ?? ({} as { course_id: string; data: CaseData });
    if (!course_id || !(await db.one(`SELECT id FROM courses WHERE org_id = $1 AND id = $2`, [u.org_id, course_id]))) throw badRequest('Unknown course_id');
    const v = await validateForOrg(db, u.org_id, data);
    reply.code(201);
    return insertCase(db, u.org_id, { course_id, data: v.data, model: v.model, author_id: u.id });
  });

  app.put<{ Params: { id: string }; Body: { data: CaseData; course_id?: string } }>('/api/cases/:id', { preHandler: auth('author') }, async (req) => {
    const u = me(req);
    const org = u.org_id;
    const h = await getCaseHead(db, org, req.params.id);
    const incoming = req.body?.data;
    if (!incoming || typeof incoming !== 'object') throw badRequest('data is required');
    if (incoming.case_id !== undefined && incoming.case_id !== h.id) throw badRequest('data.case_id cannot change; create a new case instead');
    const { data, model } = await validateForOrg(db, org, { ...incoming, case_id: h.id });
    const latest = await getCaseVersion(db, org, h.id, h.latest_version);
    const now = nowIso();
    if (req.body.course_id && req.body.course_id !== h.course_id) {
      if (!(await db.one(`SELECT id FROM courses WHERE org_id = $1 AND id = $2`, [org, req.body.course_id]))) throw badRequest('Unknown course_id');
      await db.exec(`UPDATE cases SET course_id = $1 WHERE org_id = $2 AND id = $3`, [req.body.course_id, org, h.id]);
    }
    if (latest.status === 'draft') {
      const d: CaseData = { ...data, meta: { ...(data.meta ?? {}), version: latest.version, status: 'draft' } };
      await db.exec(
        `UPDATE case_versions SET data = $1::jsonb, model_id = $2, model_version = $3, updated_at = $4
         WHERE org_id = $5 AND case_id = $6 AND version = $7`,
        [j(d), model.id, model.version, now, org, h.id, latest.version],
      );
    } else {
      // Submitted versions are immutable: a new draft version n+1 is created.
      // The published version (if any) keeps being served until n+1 is approved.
      if (latest.status === 'in_review')
        await db.exec(`UPDATE case_versions SET status = 'archived', updated_at = $1 WHERE org_id = $2 AND case_id = $3 AND version = $4`, [now, org, h.id, latest.version]);
      const n = Number(h.latest_version) + 1;
      const d: CaseData = { ...data, meta: { ...(data.meta ?? {}), version: n, status: 'draft' } };
      await db.exec(
        `INSERT INTO case_versions (org_id, case_id, version, status, data, author_id, model_id, model_version, created_at, updated_at)
         VALUES ($1, $2, $3, 'draft', $4::jsonb, $5, $6, $7, $8, $8)`,
        [org, h.id, n, j(d), u.id, model.id, model.version, now],
      );
      await db.exec(`UPDATE cases SET latest_version = $1 WHERE org_id = $2 AND id = $3`, [n, org, h.id]);
    }
    const h2 = await getCaseHead(db, org, h.id);
    return toCaseRecord(h2, await getCaseVersion(db, org, h.id, h2.latest_version));
  });

  app.post<{ Params: { id: string } }>('/api/cases/:id/submit', { preHandler: auth('author') }, async (req) => {
    const org = me(req).org_id;
    const h = await getCaseHead(db, org, req.params.id);
    const v = await getCaseVersion(db, org, h.id, h.latest_version);
    if (v.status !== 'draft') throw new HttpError(409, `Only a draft can be submitted (status is ${v.status})`);
    await validateForOrg(db, org, v.data);
    const now = nowIso();
    await db.exec(
      `UPDATE case_versions SET status = 'in_review', submitted_at = $1, updated_at = $1 WHERE org_id = $2 AND case_id = $3 AND version = $4`,
      [now, org, h.id, v.version],
    );
    return toCaseRecord(h, await getCaseVersion(db, org, h.id, v.version));
  });

  app.post<{ Params: { id: string }; Body: { comment?: string } }>('/api/cases/:id/approve', { preHandler: auth('reviewer') }, async (req) => {
    const u = me(req);
    const org = u.org_id;
    const h = await getCaseHead(db, org, req.params.id);
    const v = await getCaseVersion(db, org, h.id, h.latest_version);
    if (v.status !== 'in_review') throw new HttpError(409, `Only a case in review can be approved (status is ${v.status})`);
    if (v.author_id === u.id) throw forbidden('The reviewer must be different from the author');
    const author = await db.one<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [v.author_id]);
    const now = nowIso();
    const data: CaseData = {
      ...v.data,
      meta: { ...(v.data.meta ?? {}), author: author?.username ?? v.author_id, reviewer: u.username, version: Number(v.version), status: 'published' },
    };
    if (h.published_version != null)
      await db.exec(`UPDATE case_versions SET status = 'archived' WHERE org_id = $1 AND case_id = $2 AND version = $3`, [org, h.id, h.published_version]);
    await db.exec(
      `UPDATE case_versions SET status = 'published', data = $1::jsonb, reviewer_id = $2, review_comment = $3, published_at = $4, updated_at = $4
       WHERE org_id = $5 AND case_id = $6 AND version = $7`,
      [j(data), u.id, req.body?.comment ?? null, now, org, h.id, v.version],
    );
    await db.exec(`UPDATE cases SET published_version = $1, first_published_at = $2 WHERE org_id = $3 AND id = $4`, [
      v.version, h.first_published_at ?? now, org, h.id,
    ]);
    return toCaseRecord(await getCaseHead(db, org, h.id), await getCaseVersion(db, org, h.id, v.version));
  });

  app.post<{ Params: { id: string }; Body: { comment: string } }>('/api/cases/:id/reject', { preHandler: auth('reviewer') }, async (req) => {
    const u = me(req);
    const org = u.org_id;
    const comment = req.body?.comment;
    if (!comment || !String(comment).trim()) throw badRequest('A comment is required when rejecting');
    const h = await getCaseHead(db, org, req.params.id);
    const v = await getCaseVersion(db, org, h.id, h.latest_version);
    if (v.status !== 'in_review') throw new HttpError(409, `Only a case in review can be rejected (status is ${v.status})`);
    await db.exec(
      `UPDATE case_versions SET status = 'draft', reviewer_id = $1, review_comment = $2, updated_at = $3 WHERE org_id = $4 AND case_id = $5 AND version = $6`,
      [u.id, comment, nowIso(), org, h.id, v.version],
    );
    return toCaseRecord(h, await getCaseVersion(db, org, h.id, v.version));
  });

  /**
   * A-01: multipart upload. Fields: `course_id`, and either `file` (xlsx
   * workbook) or two CSV files `cases` + `questions`. Each converted case is
   * validated against the org's model and created as draft v1.
   */
  app.post('/api/cases/import', { preHandler: auth('author') }, async (req, reply) => {
    const u = me(req);
    if (!req.isMultipart()) throw badRequest('Expected multipart/form-data');
    const files: Record<string, { name: string; buf: Buffer }> = {};
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === 'file') files[part.fieldname] = { name: part.filename, buf: await part.toBuffer() };
      else fields[part.fieldname] = String(part.value);
    }
    const courseId = fields.course_id;
    if (!courseId || !(await db.one(`SELECT id FROM courses WHERE org_id = $1 AND id = $2`, [u.org_id, courseId]))) throw badRequest('Unknown course_id');
    const models = await listModels(db, u.org_id);
    let conv;
    if (files.cases && files.questions) {
      conv = convertCsv(files.cases.buf.toString('utf8'), files.questions.buf.toString('utf8'), models);
    } else if (files.file) {
      if (/\.csv$/i.test(files.file.name)) throw badRequest('Upload the CSV export as two files, "cases" and "questions", or the .xlsx workbook as "file"');
      conv = await convertWorkbook(new Uint8Array(files.file.buf), models);
    } else throw badRequest('Missing file');
    const created: CaseRecord[] = [];
    const errors: ConversionError[] = [...conv.errors];
    for (const c of conv.cases) {
      try {
        const v = await validateForOrg(db, u.org_id, c);
        created.push(await insertCase(db, u.org_id, { course_id: courseId, data: v.data, model: v.model, author_id: u.id }));
      } catch (e) {
        const he = e as HttpError;
        const details = Array.isArray(he.details) ? he.details : [];
        if (details.length) for (const d of details) errors.push({ sheet: 'Cases', row: 0, case_id: c.case_id, message: String(d) });
        else errors.push({ sheet: 'Cases', row: 0, case_id: c.case_id, message: he.message });
      }
    }
    reply.code(created.length ? 201 : 200);
    return { created, errors };
  });
}

export type { CaseHeadRow };

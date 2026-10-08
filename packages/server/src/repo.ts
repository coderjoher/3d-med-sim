/**
 * Shared data-access helpers (models registry, case versions). Every function
 * takes the caller's org id and scopes its queries to it (T3-01).
 */
import { MODELS, validateCase } from '@medsim/core';
import type { CaseData, CaseRecord, CaseStatus, ModelDef } from '@medsim/core';
import { j, type Db } from './db/pool.js';
import { badRequest, HttpError, notFound, nowIso } from './http.js';

// ---------------------------------------------------------------------------
// Models (§11): per-org registry, versioned, with academic sign-off.
// ---------------------------------------------------------------------------

interface ModelRow {
  org_id: string;
  id: string;
  version: number;
  data: ModelDef;
  sign_off: ModelDef['sign_off'] | null;
}

function toModelDef(r: ModelRow): ModelDef {
  const m: ModelDef = { ...r.data, version: Number(r.version) };
  if (r.sign_off) m.sign_off = r.sign_off;
  else delete m.sign_off;
  return m;
}

/** Insert core MODELS the org does not have yet (any version). */
export async function ensureOrgModels(db: Db, orgId: string, models: ModelDef[] = MODELS): Promise<void> {
  const have = new Set((await db.many<{ id: string }>(`SELECT id FROM models WHERE org_id = $1`, [orgId])).map((r) => r.id));
  for (const m of models ?? []) {
    if (!m || have.has(m.id)) continue;
    await insertModelVersion(db, orgId, m, m.version ?? 1);
    have.add(m.id);
  }
}

export async function insertModelVersion(db: Db, orgId: string, m: ModelDef, version: number): Promise<ModelDef> {
  const { sign_off, ...data } = m;
  await db.exec(`INSERT INTO models (org_id, id, version, data, sign_off, created_at) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`, [
    orgId, m.id, version, j({ ...data, version }), j(sign_off ?? null), nowIso(),
  ]);
  return { ...m, version };
}

/** Latest version of each model in the org. */
export async function listModels(db: Db, orgId: string): Promise<ModelDef[]> {
  const rows = await db.many<ModelRow>(`SELECT * FROM models WHERE org_id = $1 ORDER BY id, version`, [orgId]);
  const latest = new Map<string, ModelRow>();
  for (const r of rows) latest.set(r.id, r);
  return [...latest.values()].map(toModelDef);
}

export async function getModel(db: Db, orgId: string, id: string, version?: number): Promise<ModelDef | undefined> {
  const r =
    version === undefined
      ? await db.one<ModelRow>(`SELECT * FROM models WHERE org_id = $1 AND id = $2 ORDER BY version DESC LIMIT 1`, [orgId, id])
      : await db.one<ModelRow>(`SELECT * FROM models WHERE org_id = $1 AND id = $2 AND version = $3`, [orgId, id, version]);
  return r ? toModelDef(r) : undefined;
}

export async function signOffModel(db: Db, orgId: string, id: string, reviewer: string, notes?: string): Promise<ModelDef> {
  const m = await getModel(db, orgId, id);
  if (!m) throw notFound('Model not found');
  const sign_off = { reviewer, date: nowIso(), ...(notes ? { notes } : {}) };
  await db.exec(`UPDATE models SET sign_off = $1::jsonb WHERE org_id = $2 AND id = $3 AND version = $4`, [j(sign_off), orgId, id, m.version]);
  return { ...m, sign_off };
}

// ---------------------------------------------------------------------------
// Cases (A-02, A-05, A-06)
// ---------------------------------------------------------------------------

export interface CaseHeadRow {
  org_id: string;
  id: string;
  course_id: string;
  author_id: string;
  latest_version: number;
  published_version: number | null;
  created_at: string;
  first_published_at: string | null;
}

export interface CaseVersionRow {
  org_id: string;
  case_id: string;
  version: number;
  status: CaseStatus;
  data: CaseData;
  author_id: string;
  reviewer_id: string | null;
  review_comment: string | null;
  model_id: string;
  model_version: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  published_at: string | null;
}

export function toCaseRecord(head: CaseHeadRow, v: CaseVersionRow): CaseRecord {
  const rec: CaseRecord = {
    id: head.id,
    org_id: head.org_id,
    course_id: head.course_id,
    version: Number(v.version),
    status: v.status,
    author_id: v.author_id,
    data: v.data,
    model_version: Number(v.model_version),
    created_at: v.created_at,
    updated_at: v.updated_at,
  };
  if (v.reviewer_id) rec.reviewer_id = v.reviewer_id;
  if (v.review_comment) rec.review_comment = v.review_comment;
  return rec;
}

export async function getCaseHead(db: Db, orgId: string, id: string): Promise<CaseHeadRow> {
  const h = await db.one<CaseHeadRow>(`SELECT * FROM cases WHERE org_id = $1 AND id = $2`, [orgId, id]);
  if (!h) throw notFound('Case not found');
  return h;
}

export async function getCaseVersion(db: Db, orgId: string, id: string, version: number): Promise<CaseVersionRow> {
  const v = await db.one<CaseVersionRow>(`SELECT * FROM case_versions WHERE org_id = $1 AND case_id = $2 AND version = $3`, [orgId, id, version]);
  if (!v) throw notFound('Case version not found');
  return v;
}

export async function listCaseHeads(db: Db, orgId: string, courseId?: string): Promise<CaseHeadRow[]> {
  return courseId
    ? db.many<CaseHeadRow>(`SELECT * FROM cases WHERE org_id = $1 AND course_id = $2 ORDER BY id`, [orgId, courseId])
    : db.many<CaseHeadRow>(`SELECT * FROM cases WHERE org_id = $1 ORDER BY id`, [orgId]);
}

/** Validate case data against the org's current model; returns the model used. */
export async function validateForOrg(db: Db, orgId: string, data: unknown): Promise<{ data: CaseData; model: ModelDef }> {
  const pre = validateCase(data);
  if (!pre.ok) throw badRequest('Case validation failed', pre.errors);
  const model = await getModel(db, orgId, pre.case.model);
  if (!model) throw badRequest('Case validation failed', [`model: "${pre.case.model}" is not registered in this organisation`]);
  const full = validateCase(data, model);
  if (!full.ok) throw badRequest('Case validation failed', full.errors);
  return { data: full.case, model };
}

export async function insertCase(
  db: Db,
  orgId: string,
  opts: { course_id: string; data: CaseData; model: ModelDef; author_id: string; status?: CaseStatus; reviewer_id?: string },
): Promise<CaseRecord> {
  const id = opts.data.case_id;
  const exists = await db.one(`SELECT id FROM cases WHERE org_id = $1 AND id = $2`, [orgId, id]);
  if (exists) throw new HttpError(409, `Case "${id}" already exists`);
  const now = nowIso();
  const status = opts.status ?? 'draft';
  const published = status === 'published';
  const data: CaseData = { ...opts.data, meta: { ...(opts.data.meta ?? {}), version: 1, status } };
  await db.exec(
    `INSERT INTO cases (org_id, id, course_id, author_id, latest_version, published_version, created_at, first_published_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
    [orgId, id, opts.course_id, opts.author_id, published ? 1 : null, now, published ? now : null],
  );
  await db.exec(
    `INSERT INTO case_versions (org_id, case_id, version, status, data, author_id, reviewer_id, model_id, model_version, created_at, updated_at, submitted_at, published_at)
     VALUES ($1, $2, 1, $3, $4::jsonb, $5, $6, $7, $8, $9, $9, $10, $10)`,
    [orgId, id, status, j(data), opts.author_id, opts.reviewer_id ?? null, opts.model.id, opts.model.version, now, published ? now : null],
  );
  const head = await getCaseHead(db, orgId, id);
  return toCaseRecord(head, await getCaseVersion(db, orgId, id, 1));
}

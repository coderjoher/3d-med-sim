/**
 * Demo data: org "Demo University" (id 'demo') with users, cohorts, courses,
 * enrolments and every built-in case published as v1 (author1, reviewed by
 * reviewer1). Used by SEED_DEMO=1, the web e2e tests and the server tests.
 */
import { BUILTIN_CASES, validateCase } from '@medsim/core';
import type { CaseData, Cohort, Course, ModelDef, Role, User } from '@medsim/core';
import { Db, j, type DbPool } from './db/pool.js';
import { migrate } from './db/migrations.js';
import { nowIso, toUser, uid, type UserRow } from './http.js';
import { ensureOrgModels, getModel } from './repo.js';
import { createUser } from './routes/admin.js';
import type { AppCtx } from './app.js';

export const DEMO_ORG = { id: 'demo', name: 'Demo University' } as const;

export const DEMO_COHORTS = [
  { key: 'A', name: 'Cohort A 2026', year: 2026 },
  { key: 'B', name: 'Cohort B 2025', year: 2025 },
] as const;

export const DEMO_COURSES = [
  { code: 'ANAT2', name: 'Anatomy II - Thorax', organs: ['heart', 'lung', 'thorax'] },
  { code: 'RENAL', name: 'Renal System', organs: ['kidney', 'renal'] },
] as const;

export interface DemoUser { username: string; password: string; display_name: string; roles: Role[]; cohort?: 'A' | 'B' }

export const DEMO_USERS: DemoUser[] = [
  { username: 'admin', password: 'admin123', display_name: 'Lab Admin', roles: ['admin'] },
  { username: 'author1', password: 'author123', display_name: 'Dr. Author One', roles: ['author'] },
  { username: 'author2', password: 'author123', display_name: 'Dr. Author Two', roles: ['author'] },
  { username: 'reviewer1', password: 'reviewer123', display_name: 'Prof. Reviewer One', roles: ['reviewer'] },
  { username: 'proctor1', password: 'proctor123', display_name: 'Proctor One', roles: ['proctor'] },
  ...[1, 2, 3, 4, 5, 6].map((i): DemoUser => ({
    username: `student${i}`, password: 'student123', display_name: `Student ${i}`, roles: ['student'], cohort: i <= 3 ? 'A' : 'B',
  })),
  { username: 'superadmin', password: 'super123', display_name: 'Super Admin', roles: ['superadmin'] },
];

export interface SeedResult {
  org: { id: string; name: string };
  users: Record<string, User>;
  cohorts: Record<'A' | 'B', Cohort>;
  courses: Record<string, Course>;
  cases: string[];
  seeded: boolean;
}

/** Map a built-in case to a demo course code by its `course` field, else by the model's organ. */
function courseFor(c: CaseData, models: ModelDef[]): string {
  const key = (c.course ?? '').toLowerCase();
  for (const co of DEMO_COURSES) if (key === co.code.toLowerCase() || key === co.name.toLowerCase()) return co.code;
  if (/renal|kidney/.test(key)) return 'RENAL';
  if (/anat|thorax|heart|cardi/.test(key)) return 'ANAT2';
  const organ = (models.find((m) => m.id === c.model)?.organ ?? c.model).toLowerCase();
  return DEMO_COURSES.find((co) => co.organs.some((o) => organ.includes(o)))?.code ?? 'ANAT2';
}

/**
 * Seed the demo organisation. Idempotent: does nothing if org 'demo' exists.
 * `rounds` = bcrypt cost (tests use a low value for speed).
 */
export async function seedDemo(pool: DbPool | Db, opts: { rounds?: number; log?: (m: string) => void } = {}): Promise<SeedResult> {
  const db = pool instanceof Db ? pool : new Db(pool);
  const log = opts.log ?? (() => {});
  await migrate(db);
  const ctx = { db } as AppCtx;
  const existing = await db.one(`SELECT id FROM orgs WHERE id = $1`, [DEMO_ORG.id]);
  if (existing) return loadDemo(db, false);

  await db.exec(`INSERT INTO orgs (id, name, created_at) VALUES ($1, $2, $3)`, [DEMO_ORG.id, DEMO_ORG.name, nowIso()]);
  await ensureOrgModels(db, DEMO_ORG.id);

  const cohortIds: Record<string, string> = {};
  for (const c of DEMO_COHORTS) {
    cohortIds[c.key] = uid();
    await db.exec(`INSERT INTO cohorts (id, org_id, name, year) VALUES ($1, $2, $3, $4)`, [cohortIds[c.key], DEMO_ORG.id, c.name, c.year]);
  }
  const courseIds: Record<string, string> = {};
  for (const c of DEMO_COURSES) {
    courseIds[c.code] = uid();
    await db.exec(`INSERT INTO courses (id, org_id, code, name) VALUES ($1, $2, $3, $4)`, [courseIds[c.code], DEMO_ORG.id, c.code, c.name]);
    for (const k of Object.keys(cohortIds))
      await db.exec(`INSERT INTO enrolments (org_id, course_id, cohort_id) VALUES ($1, $2, $3)`, [DEMO_ORG.id, courseIds[c.code], cohortIds[k]]);
  }
  const users: Record<string, User> = {};
  for (const u of DEMO_USERS)
    users[u.username] = await createUser(ctx, DEMO_ORG.id, { ...u, cohort_id: u.cohort ? cohortIds[u.cohort] : undefined }, opts.rounds ?? 10);

  const models = (await db.many<{ data: ModelDef }>(`SELECT data FROM models WHERE org_id = $1`, [DEMO_ORG.id])).map((r) => r.data);
  const now = nowIso();
  for (const c of BUILTIN_CASES ?? []) {
    if (!c || c.practice) continue;
    const model = await getModel(db, DEMO_ORG.id, c.model);
    const v = validateCase(c, model);
    if (!v.ok) log(`seed: built-in case ${c.case_id} has validation errors: ${v.errors.join('; ')}`);
    const data: CaseData = { ...c, meta: { ...(c.meta ?? {}), author: 'author1', reviewer: 'reviewer1', version: 1, status: 'published' } };
    const courseId = courseIds[courseFor(c, models)]!;
    await db.exec(
      `INSERT INTO cases (org_id, id, course_id, author_id, latest_version, published_version, created_at, first_published_at)
       VALUES ($1, $2, $3, $4, 1, 1, $5, $5)`,
      [DEMO_ORG.id, c.case_id, courseId, users.author1!.id, now],
    );
    await db.exec(
      `INSERT INTO case_versions (org_id, case_id, version, status, data, author_id, reviewer_id, model_id, model_version, created_at, updated_at, submitted_at, published_at)
       VALUES ($1, $2, 1, 'published', $3::jsonb, $4, $5, $6, $7, $8, $8, $8, $8)`,
      [DEMO_ORG.id, c.case_id, j(data), users.author1!.id, users.reviewer1!.id, c.model, model?.version ?? 1, now],
    );
  }
  log(`seed: demo org created with ${DEMO_USERS.length} users and ${(BUILTIN_CASES ?? []).filter((c) => c && !c.practice).length} published cases`);
  return loadDemo(db, true);
}

async function loadDemo(db: Db, seeded: boolean): Promise<SeedResult> {
  const org = DEMO_ORG.id;
  const users: Record<string, User> = {};
  for (const r of await db.many<UserRow>(`SELECT * FROM users WHERE org_id = $1`, [org])) users[r.username] = toUser(r);
  const cohortRows = await db.many<Cohort>(`SELECT id, org_id, name, year FROM cohorts WHERE org_id = $1`, [org]);
  const cohorts = {} as Record<'A' | 'B', Cohort>;
  for (const c of DEMO_COHORTS) {
    const r = cohortRows.find((x) => x.name === c.name);
    if (r) cohorts[c.key] = { ...r, year: Number(r.year) };
  }
  const courses: Record<string, Course> = {};
  for (const r of await db.many<Course>(`SELECT id, org_id, code, name FROM courses WHERE org_id = $1`, [org])) courses[r.code] = r;
  const cases = (await db.many<{ id: string }>(`SELECT id FROM cases WHERE org_id = $1 ORDER BY id`, [org])).map((r) => r.id);
  return { org: { ...DEMO_ORG }, users, cohorts, courses, cases, seeded };
}

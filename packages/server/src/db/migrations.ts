/**
 * Schema migrations, applied in order at startup and recorded in
 * schema_migrations. Every tenant-owned table carries org_id (T3-01).
 * Timestamps are ISO-8601 text; millisecond clocks are double precision.
 */
import type { Db } from './pool.js';

export const MIGRATIONS: Array<{ version: number; name: string; statements: string[] }> = [
  {
    version: 1,
    name: 'initial schema',
    statements: [
      `CREATE TABLE orgs (
        id text PRIMARY KEY,
        name text NOT NULL,
        created_at text NOT NULL
      )`,
      `CREATE TABLE users (
        id text PRIMARY KEY,
        org_id text NOT NULL REFERENCES orgs(id),
        username text NOT NULL,
        password_hash text NOT NULL,
        display_name text NOT NULL,
        roles jsonb NOT NULL,
        lang text,
        cohort_id text,
        handedness text,
        active boolean NOT NULL DEFAULT true,
        created_at text NOT NULL,
        UNIQUE (org_id, username)
      )`,
      `CREATE TABLE cohorts (
        id text PRIMARY KEY,
        org_id text NOT NULL REFERENCES orgs(id),
        name text NOT NULL,
        year integer NOT NULL
      )`,
      `CREATE TABLE courses (
        id text PRIMARY KEY,
        org_id text NOT NULL REFERENCES orgs(id),
        code text NOT NULL,
        name text NOT NULL,
        UNIQUE (org_id, code)
      )`,
      `CREATE TABLE enrolments (
        org_id text NOT NULL REFERENCES orgs(id),
        course_id text NOT NULL,
        cohort_id text NOT NULL,
        PRIMARY KEY (course_id, cohort_id)
      )`,
      `CREATE TABLE models (
        org_id text NOT NULL REFERENCES orgs(id),
        id text NOT NULL,
        version integer NOT NULL,
        data jsonb NOT NULL,
        sign_off jsonb,
        created_at text NOT NULL,
        PRIMARY KEY (org_id, id, version)
      )`,
      `CREATE TABLE cases (
        org_id text NOT NULL REFERENCES orgs(id),
        id text NOT NULL,
        course_id text NOT NULL,
        author_id text NOT NULL,
        latest_version integer NOT NULL,
        published_version integer,
        created_at text NOT NULL,
        first_published_at text,
        PRIMARY KEY (org_id, id)
      )`,
      `CREATE TABLE case_versions (
        org_id text NOT NULL REFERENCES orgs(id),
        case_id text NOT NULL,
        version integer NOT NULL,
        status text NOT NULL,
        data jsonb NOT NULL,
        author_id text NOT NULL,
        reviewer_id text,
        review_comment text,
        model_id text NOT NULL,
        model_version integer NOT NULL,
        created_at text NOT NULL,
        updated_at text NOT NULL,
        submitted_at text,
        published_at text,
        PRIMARY KEY (org_id, case_id, version)
      )`,
      `CREATE TABLE sessions (
        id text PRIMARY KEY,
        org_id text NOT NULL REFERENCES orgs(id),
        name text NOT NULL,
        cohort_id text NOT NULL,
        case_ids jsonb NOT NULL,
        status text NOT NULL,
        started_at text,
        stopped_at text,
        time_limit_min double precision,
        created_by text NOT NULL,
        created_at text NOT NULL
      )`,
      `CREATE TABLE stations (
        org_id text NOT NULL REFERENCES orgs(id),
        id text NOT NULL,
        session_id text,
        state jsonb NOT NULL,
        commands jsonb NOT NULL,
        last_seen double precision NOT NULL,
        PRIMARY KEY (org_id, id)
      )`,
      `CREATE TABLE attempts (
        id text PRIMARY KEY,
        org_id text NOT NULL REFERENCES orgs(id),
        client_attempt_id text NOT NULL,
        student_id text NOT NULL,
        case_id text NOT NULL,
        case_version integer NOT NULL,
        model_id text NOT NULL,
        model_version integer NOT NULL,
        session_id text,
        station_id text,
        status text NOT NULL,
        started_at double precision NOT NULL,
        submitted_at text,
        timed_out boolean NOT NULL DEFAULT false,
        needed_help boolean NOT NULL DEFAULT false,
        answers jsonb,
        log jsonb,
        result jsonb,
        score double precision,
        max_score double precision,
        percent double precision,
        pending_manual integer NOT NULL DEFAULT 0,
        UNIQUE (org_id, client_attempt_id)
      )`,
      `CREATE TABLE manual_grades (
        id text PRIMARY KEY,
        org_id text NOT NULL REFERENCES orgs(id),
        attempt_id text NOT NULL,
        question_id text NOT NULL,
        points double precision NOT NULL,
        grader_id text NOT NULL,
        graded_at text NOT NULL
      )`,
      `CREATE TABLE sus_responses (
        id text PRIMARY KEY,
        org_id text NOT NULL REFERENCES orgs(id),
        user_id text NOT NULL,
        answers jsonb NOT NULL,
        lang text,
        score double precision NOT NULL,
        created_at text NOT NULL
      )`,
      `CREATE TABLE exam_scores (
        org_id text NOT NULL REFERENCES orgs(id),
        student_id text NOT NULL,
        course_id text NOT NULL,
        percent double precision NOT NULL,
        PRIMARY KEY (org_id, student_id, course_id)
      )`,
      `CREATE INDEX attempts_org_case ON attempts (org_id, case_id)`,
      `CREATE INDEX case_versions_org_case ON case_versions (org_id, case_id)`,
    ],
  },
];

export async function migrate(db: Db): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at text NOT NULL)`);
  const applied = new Set((await db.many<{ version: number }>(`SELECT version FROM schema_migrations`)).map((r) => Number(r.version)));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    for (const s of m.statements) await db.exec(s);
    await db.exec(`INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)`, [m.version, m.name, new Date().toISOString()]);
  }
}

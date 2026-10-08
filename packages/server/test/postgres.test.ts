/**
 * T1-21: data persists in PostgreSQL. All other suites also run on PostgreSQL
 * when TEST_DATABASE_URL is set (see helpers.ts BACKENDS); this file checks
 * persistence across an app restart on the same database.
 */
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { createPgPool } from '../src/db/pool.js';
import { seedDemo } from '../src/seed.js';
import { BACKENDS, JWT_SECRET, cid } from './helpers.js';
import { card010Answers, logFor } from './fixtures.js';

const url = process.env.TEST_DATABASE_URL;

describe('postgres persistence', () => {
  it.skipIf(!url)('[T1-21] data persists in PostgreSQL across server restarts', async () => {
    const schema = `t1_21_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    try {
      const pool1 = createPgPool(url!, { schema });
      await seedDemo(pool1, { rounds: 4 });
      const app1 = await buildApp({ db: pool1, jwtSecret: JWT_SECRET });
      const login = async (app: typeof app1) =>
        (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'student1', password: 'student123' } })).json().token as string;
      const t1 = await login(app1);
      const auth = { authorization: `Bearer ${t1}` };
      const st = (await app1.inject({ method: 'POST', url: '/api/attempts/start', headers: auth, payload: { client_attempt_id: cid(), case_id: 'CARD-010' } })).json();
      await app1.inject({ method: 'POST', url: `/api/attempts/${st.attempt_id}/submit`, headers: auth, payload: { client_attempt_id: '', answers: card010Answers(), log: logFor('CARD-010') } });
      await app1.close();
      await pool1.end();

      // the rows are really in PostgreSQL
      const r = await admin.query(`SELECT score, result FROM ${schema}.attempts WHERE id = $1`, [st.attempt_id]);
      expect(Number(r.rows[0].score)).toBe(5);
      expect(r.rows[0].result.percent).toBe(100);
      const tables = await admin.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [schema]);
      expect(tables.rows.map((x) => x.table_name)).toEqual(
        expect.arrayContaining(['orgs', 'users', 'cohorts', 'courses', 'enrolments', 'models', 'cases', 'case_versions', 'sessions', 'stations', 'attempts', 'manual_grades', 'sus_responses', 'exam_scores']),
      );

      // a fresh server on the same database sees the attempt; migrations and seeding are idempotent
      const pool2 = createPgPool(url!, { schema });
      const again = await seedDemo(pool2, { rounds: 4 });
      expect(again.seeded).toBe(false);
      const app2 = await buildApp({ db: pool2, jwtSecret: JWT_SECRET });
      const t2 = await login(app2);
      const list = (await app2.inject({ method: 'GET', url: '/api/attempts', headers: { authorization: `Bearer ${t2}` } })).json();
      expect(list.map((a: { id: string }) => a.id)).toContain(st.attempt_id);
      await app2.close();
      await pool2.end();
    } finally {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('[T1-21] the API suites run on every configured backend', () => {
    expect(BACKENDS.map((b) => b.name)).toEqual(url ? ['pg-mem', 'postgres'] : ['pg-mem']);
  });
});

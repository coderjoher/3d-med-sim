/**
 * Test harness. Every suite runs against pg-mem and, when TEST_DATABASE_URL is
 * set, against real PostgreSQL too (T1-21). Each harness gets an isolated
 * PostgreSQL schema that is dropped afterwards.
 */
import pg from 'pg';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { createMemoryPool, createPgPool, type DbPool } from '../src/db/pool.js';
import { seedDemo, type SeedResult } from '../src/seed.js';

export interface Backend {
  name: string;
  make(): Promise<{ pool: DbPool; cleanup(): Promise<void> }>;
}

const memory: Backend = {
  name: 'pg-mem',
  async make() {
    const pool = await createMemoryPool();
    return { pool, cleanup: () => pool.end() };
  },
};

const postgres = (url: string): Backend => ({
  name: 'postgres',
  async make() {
    const schema = `t_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const pool = createPgPool(url, { schema });
    return {
      pool,
      async cleanup() {
        await pool.end();
        const c = new pg.Client({ connectionString: url });
        await c.connect();
        await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await c.end();
      },
    };
  },
});

export const BACKENDS: Backend[] = [memory, ...(process.env.TEST_DATABASE_URL ? [postgres(process.env.TEST_DATABASE_URL)] : [])];

export const JWT_SECRET = 'test-secret';

export interface Harness {
  app: FastifyInstance;
  pool: DbPool;
  seed: SeedResult;
  token(username: string, password?: string): Promise<string>;
  req(method: string, url: string, token?: string, body?: unknown): Promise<LightMyRequestResponse>;
  json<T = any>(method: string, url: string, token?: string, body?: unknown, expect?: number): Promise<T>;
  close(): Promise<void>;
}

const PASSWORDS: Record<string, string> = {
  admin: 'admin123', author1: 'author123', author2: 'author123', reviewer1: 'reviewer123', proctor1: 'proctor123', superadmin: 'super123',
};

export async function makeHarness(backend: Backend): Promise<Harness> {
  const { pool, cleanup } = await backend.make();
  const seed = await seedDemo(pool, { rounds: 4 });
  const app = await buildApp({ db: pool, jwtSecret: JWT_SECRET });
  const tokens = new Map<string, string>();
  const req = (method: string, url: string, token?: string, body?: unknown) =>
    app.inject({
      method: method as 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(body !== undefined ? { payload: body as object } : {}),
    });
  const h: Harness = {
    app,
    pool,
    seed,
    req,
    async token(username, password) {
      const key = `${username}:${password ?? ''}`;
      if (tokens.has(key)) return tokens.get(key)!;
      const r = await req('POST', '/api/auth/login', undefined, {
        username, password: password ?? PASSWORDS[username] ?? (username.startsWith('student') ? 'student123' : ''),
      });
      if (r.statusCode !== 200) throw new Error(`login ${username} failed: ${r.statusCode} ${r.body}`);
      const t = r.json().token as string;
      tokens.set(key, t);
      return t;
    },
    async json(method, url, token, body, expect = 200) {
      const r = await req(method, url, token, body);
      if (r.statusCode !== expect) throw new Error(`${method} ${url}: expected ${expect}, got ${r.statusCode}: ${r.body}`);
      return r.json();
    },
    async close() {
      await app.close();
      await cleanup();
    },
  };
  return h;
}

/** Deep search for a key anywhere in a JSON value. */
export function hasKeyDeep(v: unknown, key: string): boolean {
  if (Array.isArray(v)) return v.some((x) => hasKeyDeep(x, key));
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => k === key || hasKeyDeep(x, key));
  return false;
}

let n = 0;
export const cid = (p = 'c') => `${p}-${Date.now().toString(36)}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

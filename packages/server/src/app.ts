/**
 * Fastify app factory for the MedSim Lab server (PRD §12). Implements the HTTP
 * contract in packages/core/src/api.ts. Testable with `app.inject`.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { Db, type DbPool } from './db/pool.js';
import { migrate } from './db/migrations.js';
import { HttpError, makeGuards } from './http.js';
import { ensureOrgModels } from './repo.js';
import { adminRoutes } from './routes/admin.js';
import { caseRoutes } from './routes/cases.js';
import { sessionRoutes } from './routes/sessions.js';
import { attemptRoutes } from './routes/attempts.js';
import { reportRoutes } from './routes/reports.js';
import { packageRoutes } from './routes/packages.js';

export interface AppOptions {
  /** pg Pool (PostgreSQL) or the pg-mem compatible pool from createMemoryPool(). */
  db: DbPool;
  jwtSecret: string;
  /** Built SPA (apps/web/dist); served with history fallback for /station/* and /portal/*. */
  webDist?: string;
  /** Directory of glTF/GLB model assets, served under /assets/. */
  assetsDir?: string;
  logger?: boolean;
}

export interface AppCtx {
  db: Db;
  jwtSecret: string;
  auth: ReturnType<typeof makeGuards>['auth'];
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const db = new Db(opts.db);
  await migrate(db);
  for (const o of await db.many<{ id: string }>(`SELECT id FROM orgs`)) await ensureOrgModels(db, o.id);

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 4 } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.status).send(err.details === undefined ? { error: err.message } : { error: err.message, details: err.details });
      return;
    }
    const e = err as { statusCode?: number; message?: string; validation?: unknown };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      reply.code(e.statusCode).send({ error: e.message ?? 'Bad request', ...(e.validation ? { details: e.validation } : {}) });
      return;
    }
    reply.log.error(err);
    reply.code(500).send({ error: e.message || 'Internal server error' });
  });

  const ctx: AppCtx = { db, jwtSecret: opts.jwtSecret, auth: makeGuards(db, opts.jwtSecret).auth };

  app.get('/api/health', async () => ({ ok: true, time: Date.now() }));
  await adminRoutes(app, ctx);
  await caseRoutes(app, ctx);
  await sessionRoutes(app, ctx);
  await attemptRoutes(app, ctx);
  await reportRoutes(app, ctx);
  await packageRoutes(app, ctx);

  // Static: model assets and the built SPA. Vite also emits /assets/*, so both
  // directories are served from one /assets/ mount (model assets win).
  const webDist = opts.webDist && existsSync(opts.webDist) ? resolve(opts.webDist) : undefined;
  const assetRoots = [opts.assetsDir && existsSync(opts.assetsDir) ? resolve(opts.assetsDir) : undefined, webDist && existsSync(join(webDist, 'assets')) ? join(webDist, 'assets') : undefined].filter(
    (x): x is string => !!x,
  );
  if (assetRoots.length)
    await app.register(fastifyStatic, { root: assetRoots.length === 1 ? assetRoots[0]! : assetRoots, prefix: '/assets/', decorateReply: !webDist, index: false });
  if (webDist) await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: true, index: 'index.html', allowedPath: (p) => !p.startsWith('/assets/') });

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0]!;
    if (webDist && req.method === 'GET' && !path.startsWith('/api') && !path.startsWith('/assets/') && !/\.[a-z0-9]{1,8}$/i.test(path)) {
      // SPA history fallback (/station/*, /portal/*, ...)
      return reply.type('text/html').sendFile('index.html', webDist);
    }
    return reply.code(404).send({ error: `Route ${req.method} ${path} not found` });
  });

  return app;
}

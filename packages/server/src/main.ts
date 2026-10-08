/**
 * Server entrypoint.
 * Env: PORT (3000), HOST (0.0.0.0), DATABASE_URL (absent → in-memory pg-mem),
 * JWT_SECRET, SEED_DEMO=1 (seed demo org when the DB has no orgs),
 * WEB_DIST (built SPA), ASSETS_DIR (glTF model assets under /assets/).
 */
import { buildApp } from './app.js';
import { createMemoryPool, createPgPool, Db, type DbPool } from './db/pool.js';
import { migrate } from './db/migrations.js';
import { seedDemo } from './seed.js';

async function main() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const url = process.env.DATABASE_URL;
  let jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    jwtSecret = 'medsim-dev-secret-change-me';
    console.warn('[medsim] JWT_SECRET not set; using an insecure development secret');
  }
  let pool: DbPool;
  if (url) pool = createPgPool(url);
  else {
    console.warn('[medsim] DATABASE_URL not set; using an in-memory database (data is lost on restart)');
    pool = await createMemoryPool();
  }

  if (process.env.SEED_DEMO === '1' || process.env.SEED_DEMO === 'true') {
    const db = new Db(pool);
    await migrate(db);
    const orgs = await db.many(`SELECT id FROM orgs LIMIT 1`);
    if (orgs.length === 0) await seedDemo(db, { log: (m) => console.log(`[medsim] ${m}`) });
    else console.log('[medsim] SEED_DEMO: database already has organisations; skipping seed');
  }

  const app = await buildApp({
    db: pool,
    jwtSecret,
    webDist: process.env.WEB_DIST || undefined,
    assetsDir: process.env.ASSETS_DIR || undefined,
    logger: process.env.LOG !== '0',
  });
  const shutdown = async () => {
    await app.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await app.listen({ port, host });
  console.log(`[medsim] server listening on http://${host}:${port}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

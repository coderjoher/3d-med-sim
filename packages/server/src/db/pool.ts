/**
 * Database access. Production uses a `pg` Pool against PostgreSQL (PRD §12);
 * tests and zero-setup mode use an in-memory pg-mem database exposed through the
 * same Pool interface. Keep SQL within what pg-mem supports (no window
 * functions, no `= ANY($1)`; jsonb values are passed as JSON text + `::jsonb`).
 */
import pg from 'pg';

/** The subset of pg.Pool the server relies on. */
export interface DbPool {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
}

/** Thin helper around a pool. */
export class Db {
  constructor(public readonly pool: DbPool) {}

  async many<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.pool.query(sql, params);
    return r.rows as T[];
  }

  async one<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.many<T>(sql, params);
    return rows[0];
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.pool.query(sql, params);
  }
}

/** JSON → text for `$n::jsonb` parameters. */
export const j = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

/** True if the error is a unique-constraint violation. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

export function createPgPool(connectionString: string, opts: { schema?: string } = {}): DbPool {
  const config: pg.PoolConfig = { connectionString, max: 10 };
  if (opts.schema) config.options = `-c search_path=${opts.schema}`;
  return new pg.Pool(config) as unknown as DbPool;
}

/** In-memory PostgreSQL emulation (pg-mem) with a pg-compatible Pool. */
export async function createMemoryPool(): Promise<DbPool> {
  const { newDb } = await import('pg-mem');
  const mem = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true });
  const { Pool } = mem.adapters.createPg();
  return new Pool() as unknown as DbPool;
}

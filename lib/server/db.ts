import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

/**
 * Server-only PostgreSQL connection layer for Backend V1 (Clients, Leads,
 * LeadEvents). Never import this from a 'use client' component or anything
 * that ends up in the browser bundle — it reads DATABASE_URL, which must
 * never reach client code. Mirrors lib/data.ts's getDb() singleton shape,
 * but a pg.Pool (unlike better-sqlite3's single connection) needs a
 * globalThis-anchored singleton: Next.js dev hot reload re-evaluates route
 * modules on file edits, and a plain module-level `let pool` would silently
 * leak a new Pool (and its live TCP connections) on every reload instead of
 * reusing one.
 */

// pg's default DATE (oid 1082) parser builds a JS Date at LOCAL midnight from
// the column's year/month/day, so `.toISOString()` on it shifts by a day in
// any timezone ahead of UTC (e.g. a 2026-01-01 DATE becomes "2025-12-31" in
// UTC+2). clients.start_date is a plain calendar date with no time
// component — keep it as the raw "YYYY-MM-DD" string pg already parsed off
// the wire, never round-tripped through a timezone-aware Date.
const PG_DATE_OID = 1082;
types.setTypeParser(PG_DATE_OID, (value: string) => value);

const globalForPg = globalThis as unknown as { __rekreativePgPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill in DATABASE_URL ' +
        '(see .env.example for the exact connection string shape).',
    );
  }
  return new Pool({
    connectionString,
    // Small, sensible pool for local dev / a single Next.js server process —
    // not tuned for multi-instance production load, which is out of scope
    // for Backend V1.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function getPool(): Pool {
  if (!globalForPg.__rekreativePgPool) {
    globalForPg.__rekreativePgPool = createPool();
  }
  return globalForPg.__rekreativePgPool;
}

/** One-off query against the pool. Never pass unparameterized user input in `text`. */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<T>(text, params);
}

/**
 * Runs `fn` inside a single BEGIN/COMMIT transaction on one checked-out
 * PoolClient. Rolls back and rethrows on any error; always releases the
 * connection back to the pool. Compound domain writes (create lead + its
 * lead_received event, stage change + its event, ingest dedupe + event)
 * must go through this — never through the pool's own query() for more than
 * one statement, since query() round-robins connections and can't hold a
 * transaction across statements.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Closes the pool. Tests only — never called from app/route code. */
export async function closePool(): Promise<void> {
  if (globalForPg.__rekreativePgPool) {
    await globalForPg.__rekreativePgPool.end();
    globalForPg.__rekreativePgPool = undefined;
  }
}

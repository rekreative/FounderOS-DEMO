import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { EnvLike } from '@/lib/backup';

/**
 * Readiness check for founder-os.db, used only by GET /api/ready. Deliberately
 * independent of lib/data.ts's getDb() - that function auto-creates and
 * seeds a missing database on first touch, which is exactly the failure this
 * probe exists to detect, not paper over. Only checks the required
 * founder-os store; bank.db/ledger.db stay optional and are never probed
 * here (same required/optional split as lib/backup.ts).
 */

const REQUIRE_EXISTING_DB_FLAG = 'FOUNDER_OS_REQUIRE_EXISTING_DB';

export function isFounderDbRequired(env: EnvLike = process.env): boolean {
  return env[REQUIRE_EXISTING_DB_FLAG] === 'true';
}

/** Same env-var-or-default resolution as lib/data.ts's getDb(). Kept
 *  independent (no import from lib/data.ts) so this probe never shares
 *  lib/data.ts's long-lived getDb() singleton or its auto-seed behavior. */
export function resolveFounderDbPath(env: EnvLike = process.env, cwd: string = process.cwd()): string {
  return env.FOUNDER_OS_DB ?? path.join(cwd, 'data', 'founder-os.db');
}

export type FounderDbReadyResult =
  | { required: false; status: 'not_required' }
  | { required: true; status: 'ok' }
  | { required: true; status: 'error' };

/**
 * Cheap, non-mutating probe: when the flag is off, always 'not_required'
 * (today's local/dev/test behavior is never affected by this check). When
 * on, opens the configured founder-os.db read-only with fileMustExist:true
 * (so a missing file throws instead of better-sqlite3 silently creating an
 * empty one) and forces a single cheap page-1 read via `PRAGMA
 * schema_version` - never `integrity_check`, which is a full-file scan and
 * has no place running on every readiness probe (see lib/backup.ts, where
 * that heavier check is reserved for the manual backup pipeline). The
 * handle is always closed, on every path. A required ':memory:' path is
 * always 'ok' - it never persists across process boundaries, so "missing"
 * is meaningless for it.
 *
 * Returns only a status enum, never the resolved path or the underlying
 * error - callers that want the raw error for server-side logging should
 * catch it themselves; this function already logs it here with a stable
 * '[ready]' prefix so a caller doesn't have to duplicate that.
 */
export function checkFounderDbReady(env: EnvLike = process.env, cwd: string = process.cwd()): FounderDbReadyResult {
  if (!isFounderDbRequired(env)) {
    return { required: false, status: 'not_required' };
  }

  const dbPath = resolveFounderDbPath(env, cwd);
  if (dbPath === ':memory:') {
    return { required: true, status: 'ok' };
  }

  let db: InstanceType<typeof Database> | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('schema_version');
    return { required: true, status: 'ok' };
  } catch (error) {
    // Server-side only - never forwarded to a client response. Logging the
    // full error (which may include the path) here matches the existing
    // convention in lib/server/ops-status.ts's getPostgresHealth() and
    // app/api/ready/route.ts's own Postgres check.
    console.error('[ready] founder-os SQLite check failed:', error);
    return { required: true, status: 'error' };
  } finally {
    db?.close();
  }
}

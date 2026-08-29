import { query } from '@/lib/server/db';
import type { EnvLike } from '@/lib/backup';
import { resolveFounderDbPath } from './sqlite-ready';
import { readSqliteInstallation } from './sqlite-installation';
import { PG_INSTALLATIONS_TABLE, INSTALLATION_STORE_NAME } from './installation-registration';
import { InstallationMarkerInvalidError, InstallationSqliteUnavailableError } from './installation-errors';

/**
 * checks.installation status for GET /api/ready (REKREOS Phase 2).
 * Deliberately independent of lib/data.ts's getDb() - same reasoning as
 * lib/server/sqlite-ready.ts's checkFounderDbReady(). 'not_required' (and
 * never affects overall `ok`) unless FOUNDER_OS_VERIFY_INSTALLATION is
 * exactly 'true'; today's local/dev/CI/test behavior is completely
 * unchanged when the flag is unset.
 */

const VERIFY_FLAG = 'FOUNDER_OS_VERIFY_INSTALLATION';
const REQUIRE_DB_FLAG = 'FOUNDER_OS_REQUIRE_EXISTING_DB';

export function isInstallationVerificationEnabled(env: EnvLike = process.env): boolean {
  return env[VERIFY_FLAG] === 'true';
}

export type InstallationReadyStatus = 'not_required' | 'ok' | 'error';

type SafeReadyCategory = 'sqlite_unavailable' | 'sqlite_marker_invalid' | 'postgres_unavailable';

/**
 * Maps any error this check can encounter to one of a small, fixed set of
 * safe category strings - never the error's own message or stack. A plain
 * Postgres/network failure (or anything unrecognized) is never inspected
 * for its message/code here (unlike app/api/ready/route.ts's Postgres
 * check, which only reads a SQLSTATE code) - this module has no code path
 * that legitimately needs more than "which side failed", so the safest
 * option is to not touch the error's own fields at all.
 */
function safeCategory(error: unknown): SafeReadyCategory {
  if (error instanceof InstallationSqliteUnavailableError) return 'sqlite_unavailable';
  if (error instanceof InstallationMarkerInvalidError) return 'sqlite_marker_invalid';
  return 'postgres_unavailable';
}

/**
 * Never throws - every failure path (missing/invalid/mismatched marker,
 * unreachable Postgres, misconfigured flag combination) resolves to
 * 'error'. Never creates, seeds, modifies, or repairs anything, and never
 * returns the resolved path or either installation id - only the status
 * enum, same contract as checkFounderDbReady().
 */
export async function checkInstallationReady(
  env: EnvLike = process.env,
  cwd: string = process.cwd(),
): Promise<InstallationReadyStatus> {
  if (!isInstallationVerificationEnabled(env)) return 'not_required';

  // Defense in depth - mirrors the same requirement enforced by
  // scripts/verify-installation.js before server.js is spawned.
  if (env[REQUIRE_DB_FLAG] !== 'true') return 'error';

  try {
    const dbPath = resolveFounderDbPath(env, cwd);
    const sqliteRow = readSqliteInstallation(dbPath);
    if (!sqliteRow) return 'error';

    const { rows } = await query<{ installation_id: string }>(
      `SELECT installation_id FROM ${PG_INSTALLATIONS_TABLE} WHERE store_name = $1`,
      [INSTALLATION_STORE_NAME],
    );
    if (rows.length !== 1) return 'error';
    if (rows[0].installation_id !== sqliteRow.installationId) return 'error';

    return 'ok';
  } catch (error) {
    console.error('[ready] installation marker check failed:', safeCategory(error));
    return 'error';
  }
}

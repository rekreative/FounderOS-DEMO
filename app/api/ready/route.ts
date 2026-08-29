import { NextResponse } from 'next/server';
import { query } from '@/lib/server/db';
import { checkFounderDbReady } from '@/lib/server/sqlite-ready';
import { checkInstallationReady } from '@/lib/server/installation-ready';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ready
 *
 * Unauthenticated application/database readiness check. Postgres is always
 * required, checked with the same `SELECT 1` primitive lib/server/ops-status.ts
 * uses. founder-os SQLite is additionally required only when
 * FOUNDER_OS_REQUIRE_EXISTING_DB=true (see lib/data.ts / lib/server/sqlite-ready.ts
 * and docs/deployment.md); when that flag is off, its check reports
 * 'not_required' and never affects `ok`, so local/dev/CI behavior here is
 * unchanged. bank.db/ledger.db stay optional and are never checked.
 * `checks.installation` (REKREOS Phase 2, see
 * lib/server/installation-ready.ts and docs/deployment.md) reports whether
 * founder-os.db's stable installation UUID still matches the one registered
 * in Postgres - additive, and 'not_required' (never affecting `ok`) unless
 * FOUNDER_OS_VERIFY_INSTALLATION=true.
 *
 * Diagnostic/monitoring signal only: Railway's healthcheck points at
 * /api/health (process liveness), not this route, so a transient DB outage
 * never takes down an otherwise-healthy process. See middleware.ts for the
 * public-route exception that lets this bypass the Supabase session check.
 */

type SafeCategory = 'auth' | 'network' | 'dns' | 'tls' | 'timeout' | 'other';

function safeCategory(error: unknown): SafeCategory {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION_TIMEOUT') return 'timeout';
  if (code.startsWith('ECONN') || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'network';
  if (code.startsWith('SELF_SIGNED') || code.startsWith('CERT_') || code.startsWith('ERR_TLS')) return 'tls';
  if (code === '28P01' || code === '28000') return 'auth';
  return 'other';
}

type CheckStatus = 'ok' | 'error';

async function checkPostgres(): Promise<CheckStatus> {
  try {
    await query('SELECT 1');
    return 'ok';
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined;
    console.error('[ready] Postgres check failed:', { name, code, category: safeCategory(error) });
    return 'error';
  }
}

export async function GET(): Promise<Response> {
  const postgres = await checkPostgres();
  const sqlite = checkFounderDbReady();
  const installation = await checkInstallationReady();

  const ok = postgres === 'ok' && sqlite.status !== 'error' && installation !== 'error';
  const body = { ok, checks: { postgres, sqlite: sqlite.status, installation } };
  return NextResponse.json(body, { status: ok ? 200 : 503 });
}

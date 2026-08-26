import { NextResponse } from 'next/server';
import { query } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ready
 *
 * Unauthenticated application/database readiness check — pings Postgres
 * with the same `SELECT 1` primitive lib/server/ops-status.ts uses.
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

export async function GET(): Promise<Response> {
  try {
    await query('SELECT 1');
    return NextResponse.json({ ok: true });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined;
    console.error('[ready] Postgres check failed:', { name, code, category: safeCategory(error) });
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

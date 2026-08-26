import { NextResponse } from 'next/server';
import { query } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Unauthenticated deployment health check (Railway / load balancer). Pings
 * Postgres with the same `SELECT 1` primitive lib/server/ops-status.ts uses,
 * but returns nothing beyond a boolean — no connection string, host, schema,
 * latency, or error detail. See middleware.ts for the public-route exception
 * that lets this bypass the Supabase session check.
 */
export async function GET(): Promise<Response> {
  try {
    await query('SELECT 1');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[health] Postgres check failed:', error);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

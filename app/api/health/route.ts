import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Railway liveness probe — proves only that the Next.js process is up and
 * can serve a request. Deliberately does NOT touch Postgres/DATABASE_URL: a
 * transient database outage must not make Railway kill an otherwise-healthy
 * process. See app/api/ready/route.ts for the DB-readiness counterpart, and
 * middleware.ts for the public-route exception that lets this bypass the
 * Supabase session check.
 */
export async function GET(): Promise<Response> {
  return NextResponse.json({ ok: true });
}

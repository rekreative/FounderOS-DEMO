import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { syncFromZernioLive } from '@/lib/social-live';
import { zernioLiveAccounts } from '@/lib/connectors/zernio';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { unexpectedError } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Force a live follower-count sync from Zernio/Late and report what landed.
    GET and POST both work so it's trivial to trigger from a browser or curl.
    Shared by both exported handlers below, so the operational boundary is
    written once, not duplicated per method. */
async function runSync(routeLabel: string) {
  try {
    const db = getDb();
    const accounts = await zernioLiveAccounts();
    const recorded = await syncFromZernioLive(db, { source: async () => accounts });
    return NextResponse.json({
      ok: true,
      recorded,
      syncedAt: new Date().toISOString(),
      source: Object.keys(accounts).length > 0 ? 'zernio-live' : 'config-fallback',
      accounts,
    });
  } catch (error) {
    return unexpectedError(routeLabel, error);
  }
}

export async function POST() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  return runSync('POST /api/social/sync');
}

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  return runSync('GET /api/social/sync');
}

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { syncFromZernioLive } from '@/lib/social-live';
import { zernioLiveAccounts } from '@/lib/connectors/zernio';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/** Force a live follower-count sync from Zernio/Late and report what landed.
    GET and POST both work so it's trivial to trigger from a browser or curl. */
async function runSync() {
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
}

export async function POST() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  return runSync();
}

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  return runSync();
}

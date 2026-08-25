import { NextResponse } from 'next/server';
import { getOpsSnapshot } from '@/lib/server/ops-status';
import { unexpectedError } from '@/lib/server/http';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/status
 *
 * The one canonical operational-evidence snapshot for /connections,
 * /automations, /ai-agents and Home's real attention list — see
 * lib/server/ops-status.ts for how every status is derived. Never returns
 * secrets: no API keys, no DATABASE_URL, only booleans/status strings and
 * lead/event-derived text.
 */
export async function GET(): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  try {
    const snapshot = await getOpsSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    return unexpectedError('GET /api/ops/status', error);
  }
}

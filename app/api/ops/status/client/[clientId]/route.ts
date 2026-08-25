import { NextResponse } from 'next/server';
import { getClientOpsSnapshot } from '@/lib/server/ops-status';
import { unexpectedError } from '@/lib/server/http';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/status/client/[clientId]
 *
 * Client Truth Alignment V1 — the per-clients.id counterpart to
 * GET /api/ops/status (see lib/server/ops-status.ts's getClientOpsSnapshot).
 * Powers the Client Workspace's Automations/AI Agents tabs and Overview
 * summaries. An unknown/garbage clientId resolves to a neutral all-quiet
 * snapshot, never a 404 — absence of evidence is never an error. Never
 * returns secrets, same contract as GET /api/ops/status.
 */
export async function GET(_request: Request, { params }: { params: { clientId: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  try {
    const snapshot = await getClientOpsSnapshot(params.clientId);
    return NextResponse.json(snapshot);
  } catch (error) {
    return unexpectedError('GET /api/ops/status/client/[clientId]', error);
  }
}

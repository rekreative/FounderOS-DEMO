import { NextResponse } from 'next/server';
import { getClientOpsSnapshot } from '@/lib/server/ops-status';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { canAccessClientScopedObject, requireUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ops/status/client/[clientId]
 *
 * Client Truth Alignment V1 — the per-clients.id counterpart to
 * GET /api/ops/status (see lib/server/ops-status.ts's getClientOpsSnapshot).
 * Powers the Client Workspace's Automations/AI Agents tabs and Overview
 * summaries.
 *
 * Tenant-aware: params.clientId IS the object being requested here (unlike
 * leads, there's no separate row to fetch first), so access is checked
 * directly against it. For internal, an unknown/garbage clientId still
 * resolves to a neutral all-quiet snapshot, never a 404 — absence of
 * evidence is never an error. For a client-role caller without a grant for
 * this clientId, the response is the same 404 every other cross-tenant
 * object-scoped route uses — it must not confirm whether the clientId is
 * real. Never returns secrets, same contract as GET /api/ops/status.
 */
export async function GET(_request: Request, { params }: { params: { clientId: string } }): Promise<Response> {
  const auth = await requireUserOrResponse();
  if ('response' in auth) return auth.response;
  if (!(await canAccessClientScopedObject(auth.user, params.clientId))) return jsonError(404, 'not found');

  try {
    const snapshot = await getClientOpsSnapshot(params.clientId);
    return NextResponse.json(snapshot);
  } catch (error) {
    return unexpectedError('GET /api/ops/status/client/[clientId]', error);
  }
}

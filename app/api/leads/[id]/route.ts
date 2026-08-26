import { NextResponse } from 'next/server';
import { getLeadById, updateLead } from '@/lib/server/leads-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { UpdateLeadBodySchema } from '@/lib/server/schemas';
import { canAccessClientScopedObject, requireInternalUserOrResponse, requireUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * Tenant-aware: authorization is derived from the fetched lead's own
 * clientId (never a caller-supplied value — there isn't one on this route
 * anyway). A lead with clientId null (internal-scoped) is invisible to
 * client-role callers, same 404 as an unknown id.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireUserOrResponse();
  if ('response' in auth) return auth.response;

  try {
    const lead = await getLeadById(params.id);
    if (!lead) return jsonError(404, 'lead not found');
    if (!(await canAccessClientScopedObject(auth.user, lead.clientId))) return jsonError(404, 'lead not found');
    return NextResponse.json({ lead });
  } catch (error) {
    return unexpectedError('GET /api/leads/[id]', error);
  }
}

/**
 * Business fields only — see UpdateLeadBodySchema/UpdateLeadInput. `stage`
 * is deliberately not accepted here: POST /api/leads/[id]/stage is the only
 * path that changes stage, because that's the only path that also appends
 * the matching stage_changed event.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = UpdateLeadBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const lead = await updateLead(params.id, parsed.data);
    if (!lead) return jsonError(404, 'lead not found');
    return NextResponse.json({ lead });
  } catch (error) {
    return unexpectedError('PATCH /api/leads/[id]', error);
  }
}

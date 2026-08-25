import { NextResponse } from 'next/server';
import { getLeadById, updateLead } from '@/lib/server/leads-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { UpdateLeadBodySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  try {
    const lead = await getLeadById(params.id);
    if (!lead) return jsonError(404, 'lead not found');
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

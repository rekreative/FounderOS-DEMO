import { NextResponse } from 'next/server';
import { LeadStageTransitionError, getLeadById, setLeadStage } from '@/lib/server/leads-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { StageChangeBodySchema } from '@/lib/server/schemas';
import { canAccessClientScopedObject, requireUserOrResponse } from '@/lib/server/api-auth';
import { dispatchMetaCapiLiveEvent } from '@/lib/server/meta-capi-live';

export const dynamic = 'force-dynamic';

/** POST { "stage": "qualified" } — the only path that changes a lead's
 *  stage, because it's the only path that atomically appends the matching
 *  stage_changed event too (see lib/server/leads-repo.ts's setLeadStage). */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = StageChangeBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const lead = await getLeadById(params.id);
    if (!lead || !(await canAccessClientScopedObject(auth.user, lead.clientId))) return jsonError(404, 'lead not found');
    const result = await setLeadStage(params.id, parsed.data.stage, 'manual');
    if (!result) return jsonError(404, 'lead not found');
    const kind = parsed.data.stage === 'qualified' ? 'qualified_lead' : parsed.data.stage === 'appointment' ? 'appointment' : null;
    if (kind && result.event) {
      // Delivery failure is persisted independently and must never undo the
      // commercial stage already committed in REKREOS.
      await dispatchMetaCapiLiveEvent({
        leadId: result.lead.id,
        kind,
        occurredAt: new Date(result.event.occurredAt),
        createdBy: auth.user.id,
      }).catch(() => undefined);
    }
    return NextResponse.json({ lead: result.lead, event: result.event });
  } catch (error) {
    if (error instanceof LeadStageTransitionError) return jsonError(409, error.message);
    return unexpectedError('POST /api/leads/[id]/stage', error);
  }
}

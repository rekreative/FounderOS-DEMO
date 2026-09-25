import { NextResponse } from 'next/server';
import {
  CommercialConversionValidationError,
  LeadNotFoundError,
  LeadStageTransitionError,
  appendCommercialEvent,
  getLeadById,
  type CommercialEventType,
} from '@/lib/server/leads-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { ManualCommercialEventBodySchema } from '@/lib/server/schemas';
import { canAccessClientScopedObject, requireUserOrResponse } from '@/lib/server/api-auth';
import { dispatchMetaCapiLiveEvent } from '@/lib/server/meta-capi-live';

export const dynamic = 'force-dynamic';

const DEFAULT_SUMMARY: Record<CommercialEventType, string> = {
  proposal_sent: 'Propuesta enviada',
  qualified: 'Lead qualified',
  appointment_booked: 'Appointment booked',
  appointment_completed: 'Appointment completed',
  appointment_confirmed: 'Cita confirmada',
  appointment_cancelled: 'Cita cancelada',
  appointment_no_show: 'No acudió a la cita',
  converted: 'Lead converted',
  disqualified: 'Lead disqualified',
};

/**
 * Manual-facing surface for the Leads UI's commercial quick actions (Cita
 * agendada / Cita realizada / Convertido / Descartado). Reuses the exact
 * same appendCommercialEvent primitive POST /api/leads/commercial-events
 * (Make) calls — only `source` differs ('manual' here, hardcoded, never
 * caller-supplied) and there's no externalEventId (proposals are deduped
 * per lead; other manual actions retain their existing behavior). Session
 * authorization is resolved from the lead's stored clientId, exactly like
 * POST /api/leads/[id]/stage and POST /api/leads/[id]/events.
 */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = ManualCommercialEventBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  const body = parsed.data;
  const summary = body.summary ?? DEFAULT_SUMMARY[body.type];

  try {
    const lead = await getLeadById(params.id);
    if (!lead || !(await canAccessClientScopedObject(auth.user, lead.clientId))) return jsonError(404, 'lead not found');
    const result = await appendCommercialEvent({
      leadId: params.id,
      type: body.type,
      source: 'manual',
      summary,
      appointmentDate: body.type === 'appointment_booked' ? body.appointmentDate : undefined,
      conversionValue: body.type === 'converted' ? body.conversionValue : undefined,
      serviceId: body.type === 'converted' ? body.serviceId : undefined,
      paymentPlan: body.type === 'converted' ? body.paymentPlan : undefined,
      initialPayment: body.type === 'converted' ? body.initialPayment : undefined,
    });

    if (body.type === 'qualified') {
      await dispatchMetaCapiLiveEvent({ leadId: result.lead.id, kind: 'qualified_lead', occurredAt: new Date(result.event.occurredAt), createdBy: auth.user.id }).catch(() => undefined);
    }
    if (body.type === 'appointment_booked') {
      await dispatchMetaCapiLiveEvent({ leadId: result.lead.id, kind: 'appointment', occurredAt: new Date(result.event.occurredAt), createdBy: auth.user.id }).catch(() => undefined);
    }
    if (body.type === 'converted' && (body.initialPayment ?? 0) > 0) {
      await dispatchMetaCapiLiveEvent({
        leadId: result.lead.id,
        kind: 'converted',
        occurredAt: new Date(result.event.occurredAt),
        sourceIdentity: `conversion:${result.event.id}`,
        purchaseValue: body.initialPayment,
        createdBy: auth.user.id,
      }).catch(() => undefined);
    }

    return NextResponse.json({ lead: result.lead, event: result.event }, { status: 201 });
  } catch (error) {
    if (error instanceof LeadNotFoundError) return jsonError(404, 'lead not found');
    if (error instanceof LeadStageTransitionError) return jsonError(409, error.message);
    if (error instanceof CommercialConversionValidationError) return jsonError(422, error.message);
    return unexpectedError('POST /api/leads/[id]/commercial-events', error);
  }
}

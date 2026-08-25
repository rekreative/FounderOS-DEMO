import { NextResponse } from 'next/server';
import { LeadNotFoundError, appendCommercialEvent, type CommercialEventType } from '@/lib/server/leads-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { ManualCommercialEventBodySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

const DEFAULT_SUMMARY: Record<CommercialEventType, string> = {
  appointment_booked: 'Appointment booked',
  appointment_completed: 'Appointment completed',
  converted: 'Lead converted',
  disqualified: 'Lead disqualified',
};

/**
 * Manual-facing surface for the Leads UI's commercial quick actions (Cita
 * agendada / Cita realizada / Convertido / Descartado). Reuses the exact
 * same appendCommercialEvent primitive POST /api/leads/commercial-events
 * (Make) calls — only `source` differs ('manual' here, hardcoded, never
 * caller-supplied) and there's no externalEventId (manual actions are never
 * deduped — see appendCommercialEvent's doc comment). No bearer-token gate:
 * same convention as the existing POST /api/leads/[id]/stage and
 * POST /api/leads/[id]/events routes this mirrors.
 */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = ManualCommercialEventBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  const body = parsed.data;
  const summary = body.summary ?? DEFAULT_SUMMARY[body.type];

  try {
    const result = await appendCommercialEvent({
      leadId: params.id,
      type: body.type,
      source: 'manual',
      summary,
      appointmentDate: body.type === 'appointment_booked' ? body.appointmentDate : undefined,
      conversionValue: body.type === 'converted' ? body.conversionValue : undefined,
    });

    return NextResponse.json({ lead: result.lead, event: result.event }, { status: 201 });
  } catch (error) {
    if (error instanceof LeadNotFoundError) return jsonError(404, 'lead not found');
    return unexpectedError('POST /api/leads/[id]/commercial-events', error);
  }
}

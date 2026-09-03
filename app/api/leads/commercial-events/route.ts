import { NextResponse } from 'next/server';
import { checkMakeEventsAuth, type MakeEventsAuthFailureReason } from '@/lib/server/make-events-auth';
import { CommercialConversionValidationError, LeadNotFoundError, appendCommercialEvent, type CommercialEventType } from '@/lib/server/leads-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { CommercialEventBodySchema } from '@/lib/server/schemas';

export const dynamic = 'force-dynamic';

const AUTH_ERROR_STATUS: Record<MakeEventsAuthFailureReason, number> = {
  not_configured: 500,
  missing_header: 401,
  malformed_header: 401,
  invalid_token: 401,
};

const AUTH_ERROR_MESSAGE: Record<MakeEventsAuthFailureReason, string> = {
  not_configured: 'commercial event ingestion is not configured',
  missing_header: 'unauthorized',
  malformed_header: 'unauthorized',
  invalid_token: 'unauthorized',
};

const DEFAULT_SUMMARY: Record<CommercialEventType, string> = {
  appointment_booked: 'Appointment booked',
  appointment_completed: 'Appointment completed',
  converted: 'Lead converted',
  disqualified: 'Lead disqualified',
};

/**
 * Make → REKREATIVE OS commercial lifecycle event reporting (Appointment +
 * Commercial Lifecycle V1). Reuses MAKE_EVENTS_API_KEY — the same trust
 * boundary as POST /api/leads/whatsapp-events (Make reporting normalized
 * lifecycle facts about a lead that already exists), not a second key.
 * REKREATIVE OS stays the source of truth for stage: this route hardcodes
 * source 'make' and never accepts a caller-supplied stage — see
 * lib/server/leads-repo.ts's appendCommercialEvent for the server-controlled
 * transition rules.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = checkMakeEventsAuth(request);
  if (!auth.ok) {
    return jsonError(AUTH_ERROR_STATUS[auth.reason], AUTH_ERROR_MESSAGE[auth.reason]);
  }

  const parsed = CommercialEventBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  const body = parsed.data;
  const summary = body.summary ?? DEFAULT_SUMMARY[body.type];

  try {
    const result = await appendCommercialEvent({
      leadId: body.leadId,
      type: body.type,
      source: 'make',
      externalEventId: body.externalEventId,
      summary,
      details: body.details ?? null,
      occurredAt: body.occurredAt,
      appointmentDate: body.type === 'appointment_booked' ? body.appointmentDate : undefined,
      conversionValue: body.type === 'converted' ? body.conversionValue : undefined,
      serviceId: body.type === 'converted' ? body.serviceId : undefined,
      paymentPlan: body.type === 'converted' ? body.paymentPlan : undefined,
      initialPayment: body.type === 'converted' ? body.initialPayment : undefined,
    });

    return NextResponse.json(
      { ok: true, leadId: result.lead.id, event: result.event, deduped: result.deduped },
      { status: result.deduped ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof LeadNotFoundError) return jsonError(404, 'lead not found');
    if (error instanceof CommercialConversionValidationError) return jsonError(422, error.message);
    return unexpectedError('POST /api/leads/commercial-events', error);
  }
}

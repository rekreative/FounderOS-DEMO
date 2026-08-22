import { NextResponse } from 'next/server';
import { checkMakeEventsAuth, type MakeEventsAuthFailureReason } from '@/lib/server/make-events-auth';
import { LeadNotFoundError, appendWhatsAppEvent } from '@/lib/server/leads-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { WhatsAppEventBodySchema } from '@/lib/server/schemas';
import type { LeadEventSource } from '@/lib/leads';

export const dynamic = 'force-dynamic';

const AUTH_ERROR_STATUS: Record<MakeEventsAuthFailureReason, number> = {
  not_configured: 500,
  missing_header: 401,
  malformed_header: 401,
  invalid_token: 401,
};

const AUTH_ERROR_MESSAGE: Record<MakeEventsAuthFailureReason, string> = {
  not_configured: 'whatsapp event ingestion is not configured',
  missing_header: 'unauthorized',
  malformed_header: 'unauthorized',
  invalid_token: 'unauthorized',
};

type WhatsAppEventType = 'whatsapp_sent' | 'whatsapp_delivered' | 'lead_replied';

// whatsapp_sent is reported by Make itself (the automation performed the
// send); whatsapp_delivered and lead_replied are provider-observed facts
// Make only relays from its own WhatsApp Business Cloud webhook — WhatsApp
// is their real origin. Never caller-supplied: a request-body `source`
// would let it spoof provenance the same way a caller-supplied `stage`
// would bypass setLeadStage's event semantics.
const EVENT_SOURCE: Record<WhatsAppEventType, LeadEventSource> = {
  whatsapp_sent: 'make',
  whatsapp_delivered: 'whatsapp',
  lead_replied: 'whatsapp',
};

const DEFAULT_SUMMARY: Record<WhatsAppEventType, string> = {
  whatsapp_sent: 'WhatsApp message sent',
  whatsapp_delivered: 'WhatsApp message delivered',
  lead_replied: 'Lead replied on WhatsApp',
};

/**
 * Make → REKREATIVE OS WhatsApp event reporting. One normalized surface for
 * both directions (see the WhatsApp + Lead Lifecycle V1 architecture note):
 *  - outbound: Make sent a message it initiated — addresses the lead by
 *    `leadId`, which Make already has from POST /api/ingest/leads' response.
 *  - inbound: Make relays a delivery receipt or reply from the WhatsApp
 *    Business Cloud webhook it owns — addresses the lead by
 *    `whatsappNumber`, since that's all Make's webhook gives it.
 *
 * REKREATIVE OS stays the source of truth for Lead/LeadEvent state; Make
 * stays the orchestration layer. This route deliberately does not receive
 * Meta's webhook directly — a future direct adapter can call
 * appendWhatsAppEvent the same way without any change to this contract.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = checkMakeEventsAuth(request);
  if (!auth.ok) {
    return jsonError(AUTH_ERROR_STATUS[auth.reason], AUTH_ERROR_MESSAGE[auth.reason]);
  }

  const parsed = WhatsAppEventBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  const body = parsed.data;
  const source = EVENT_SOURCE[body.type];
  const summary = body.summary ?? DEFAULT_SUMMARY[body.type];

  try {
    const result = await appendWhatsAppEvent({
      ...('leadId' in body ? { leadId: body.leadId } : { whatsappNumber: body.whatsappNumber }),
      type: body.type,
      source,
      externalEventId: body.externalEventId,
      summary,
      details: body.details ?? null,
      occurredAt: body.occurredAt,
    });

    if (!result.matched) {
      // Unmatched WhatsApp number: a safe no-op for Make, never fabricated
      // lead data — logged server-side so a real phone/lead mapping gap
      // stays visible without failing Make's scenario.
      console.warn(
        `[api] POST /api/leads/whatsapp-events: no lead matched the given whatsappNumber for type=${body.type}`,
      );
      return NextResponse.json({ ok: true, matched: false });
    }

    return NextResponse.json(
      { ok: true, matched: true, leadId: result.lead.id, event: result.event, deduped: result.deduped },
      { status: result.deduped ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof LeadNotFoundError) return jsonError(404, 'lead not found');
    return unexpectedError('POST /api/leads/whatsapp-events', error);
  }
}

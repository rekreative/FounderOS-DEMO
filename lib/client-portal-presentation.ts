import { LEAD_STAGE_OPTIONS, getStageLabel, type LeadEvent } from '@/lib/leads';

type PortalEvent = Pick<LeadEvent, 'type' | 'summary' | 'details'>;

const GENERATED_SUMMARIES: Partial<Record<LeadEvent['type'], Record<string, string>>> = {
  whatsapp_sent: { 'WhatsApp message sent': 'WhatsApp enviado' },
  whatsapp_delivered: { 'WhatsApp message delivered': 'WhatsApp entregado' },
  whatsapp_failed: { 'WhatsApp message could not be sent': 'No se pudo enviar el WhatsApp' },
  lead_replied: { 'Lead replied on WhatsApp': 'El lead respondió por WhatsApp' },
  qualified: { 'Lead qualified': 'Lead cualificado' },
  appointment_booked: { 'Appointment booked': 'Cita registrada' },
  appointment_completed: { 'Appointment completed': 'Cita realizada' },
  converted: { 'Lead converted': 'Lead convertido' },
  disqualified: { 'Lead disqualified': 'Lead descartado' },
};

/** Translate only system-generated phrases. Never rewrite a person's note or
 * an unknown provider message, since its exact wording may matter. */
export function formatPortalEventSummary(event: PortalEvent): string {
  if (event.type === 'manual_note') return event.summary;

  const generated = GENERATED_SUMMARIES[event.type]?.[event.summary];
  if (generated) return generated;

  if (event.type === 'stage_changed' && event.summary.startsWith('Stage changed to ')) {
    const to = event.details?.to;
    const stage = LEAD_STAGE_OPTIONS.find((option) => option.id === to);
    if (stage) return `Etapa actualizada a ${getStageLabel(stage.id)}`;
  }

  if (event.type === 'lead_received') {
    const automated = event.summary.match(/^(.+) was received via automated ingestion$/);
    if (automated) return `${automated[1]} entró mediante la automatización`;
    const manual = event.summary.match(/^(.+) was added to the REKREATIVE CRM$/);
    if (manual) return `${manual[1]} se añadió al CRM`;
  }

  if (event.type === 'ai_analyzed') {
    const analyzed = event.summary.match(/^(.+) was analyzed by AI qualification$/);
    if (analyzed) return `${analyzed[1]} se analizó automáticamente`;
  }

  return event.summary;
}

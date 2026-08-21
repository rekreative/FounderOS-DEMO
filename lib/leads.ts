import { getClients } from '@/lib/clients';

// REKREATIVE is the agency's own internal acquisition, never a client —
// scope distinguishes "REKREATIVE's own leads" (internal, clientId null)
// from "a client's leads" (client, clientId required), same invariant
// style as lib/content-items.ts / lib/agents-ai.ts / lib/integration-
// connections.ts's scope + clientId pairs. Never model REKREATIVE as a
// fake Client row.
export const LEAD_SCOPE_OPTIONS = [
  { id: 'internal', label: 'REKREATIVE' },
  { id: 'client', label: 'Clientes' },
] as const;
export type LeadScope = (typeof LEAD_SCOPE_OPTIONS)[number]['id'];

export const LEAD_STAGE_OPTIONS = [
  { id: 'new', label: 'Nuevo' },
  { id: 'contacted', label: 'Contactado' },
  { id: 'qualified', label: 'Cualificado' },
  { id: 'appointment', label: 'Cita' },
  { id: 'converted', label: 'Convertido' },
  { id: 'no_response', label: 'Sin respuesta' },
  { id: 'disqualified', label: 'Descartado' },
] as const;

export type LeadStage = (typeof LEAD_STAGE_OPTIONS)[number]['id'];
export type LeadIntent = 'cold' | 'warm' | 'hot';
export type LeadPriority = 'low' | 'medium' | 'high';

export type LeadAiAnalysis = {
  summary: string | null;
  intent: LeadIntent | null;
  priority: LeadPriority | null;
  qualification: Record<string, string> | null;
  analyzedAt: string | null;
};

/**
 * Backend V1 note: this is the domain shape as it existed under localStorage
 * V1. The canonical persistence layer is now PostgreSQL — see
 * lib/api/leads.ts (browser HTTP client, adds the ingestion-metadata fields
 * every stored row now carries) and lib/server/leads-repo.ts (server repo).
 * This file keeps only the types/enums/labels every UI surface still needs,
 * not a second source of truth.
 */
export type Lead = {
  id: string;
  scope: LeadScope;
  /** Required when scope === 'client'; always null when scope === 'internal'. */
  clientId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string;
  campaign: string | null;
  adCreative: string | null;
  form: string | null;
  stage: LeadStage;
  createdAt: string;
  lastActivityAt: string;
  aiAnalysis: LeadAiAnalysis | null;
  qualificationAnswers: Record<string, string> | null;
  appointmentDate: string | null;
  conversionValue: number | null;
};

export type LeadEventType =
  | 'lead_received'
  | 'ai_analyzed'
  | 'whatsapp_sent'
  | 'whatsapp_delivered'
  | 'lead_replied'
  | 'commercial_contacted'
  | 'appointment_booked'
  | 'appointment_completed'
  | 'converted'
  | 'disqualified'
  | 'manual_note'
  | 'stage_changed';

export type LeadEventSource = 'meta' | 'openai' | 'whatsapp' | 'make' | 'manual' | 'crm' | 'system';

export type LeadEvent = {
  id: string;
  leadId: string;
  type: LeadEventType;
  source: LeadEventSource;
  occurredAt: string;
  summary: string;
  details?: Record<string, unknown> | null;
};

export function getStageLabel(stage: LeadStage): string {
  return LEAD_STAGE_OPTIONS.find((option) => option.id === stage)?.label ?? stage;
}

/**
 * Resolves a lead's client name for display. Pass the caller's own
 * already-loaded `clients` list (the canonical PostgreSQL registry, e.g.
 * from useClientsRegistry()) wherever one is available — that's what keeps
 * this in sync with the real Client registry instead of the legacy
 * localStorage seed. The `clients` param is optional only so this keeps
 * working, with the old localStorage fallback, for any caller that hasn't
 * been touched by the Backend V1 cutover.
 */
export function getClientNameForLead(
  clientId: string | null,
  clients: { id: string; name: string }[] = getClients(),
): string {
  if (!clientId) return 'Interno';
  const client = clients.find((item) => item.id === clientId);
  return client?.name ?? 'Cliente desconocido';
}

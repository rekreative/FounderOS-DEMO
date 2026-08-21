import type {
  Lead as LeadBase,
  LeadAiAnalysis,
  LeadEvent,
  LeadEventSource,
  LeadEventType,
  LeadScope,
  LeadStage,
} from '@/lib/leads';
import { apiFetch, nullOn404 } from './http';

/**
 * Browser-facing HTTP client for the canonical PostgreSQL Leads/LeadEvents
 * CRM (Backend V1). lib/leads.ts keeps only types/constants/pure helpers
 * (getStageLabel, getClientNameForLead) after the cutover — its old
 * localStorage persistence functions are gone, since every runtime consumer
 * moved to this module. Never imports lib/server/*.
 */

export type { LeadEvent, LeadEventSource, LeadEventType, LeadScope, LeadStage, LeadAiAnalysis };

// The server returns ingestion metadata alongside every Lead row (always
// null for manual/API-created leads) — mirrors ServerLead in
// lib/server/leads-repo.ts exactly, since both describe the same JSON
// crossing the HTTP boundary.
export type Lead = LeadBase & {
  ingestionSource: string | null;
  externalLeadId: string | null;
  deliveryId: string | null;
};

export type CreateLeadInput = {
  scope: LeadScope;
  clientId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  /** Business/acquisition source ("Meta Ads", "Referral", ...). Defaults 'Manual'. */
  source?: string;
  campaign?: string | null;
  adCreative?: string | null;
  form?: string | null;
  stage?: LeadStage;
  aiAnalysis?: LeadAiAnalysis | null;
  qualificationAnswers?: Record<string, string> | null;
  appointmentDate?: string | null;
  conversionValue?: number | null;
};

// Business fields only — scope/clientId/stage are not patchable through this
// endpoint (see app/api/leads/[id]/route.ts and the dedicated stage
// endpoint), matching the server's UpdateLeadBodySchema exactly.
export type UpdateLeadInput = Partial<{
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  source: string;
  campaign: string | null;
  adCreative: string | null;
  form: string | null;
  aiAnalysis: LeadAiAnalysis | null;
  qualificationAnswers: Record<string, string> | null;
  appointmentDate: string | null;
  conversionValue: number | null;
}>;

export type ListLeadsOptions = {
  clientId?: string;
  scope?: LeadScope;
};

export async function getLeads(options: ListLeadsOptions = {}): Promise<Lead[]> {
  const params = new URLSearchParams();
  if (options.clientId) params.set('clientId', options.clientId);
  if (options.scope) params.set('scope', options.scope);
  const qs = params.toString();
  const { leads } = await apiFetch<{ leads: Lead[] }>(`/api/leads${qs ? `?${qs}` : ''}`);
  return leads;
}

export async function getLeadById(id: string): Promise<Lead | null> {
  return nullOn404(async () => {
    const { lead } = await apiFetch<{ lead: Lead }>(`/api/leads/${encodeURIComponent(id)}`);
    return lead;
  });
}

export async function createLead(input: CreateLeadInput): Promise<{ lead: Lead; event: LeadEvent }> {
  return apiFetch(`/api/leads`, { method: 'POST', body: JSON.stringify(input) });
}

export async function updateLead(id: string, patch: UpdateLeadInput): Promise<Lead | null> {
  return nullOn404(async () => {
    const { lead } = await apiFetch<{ lead: Lead }>(`/api/leads/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return lead;
  });
}

export async function setLeadStage(id: string, stage: LeadStage): Promise<{ lead: Lead; event: LeadEvent | null } | null> {
  return nullOn404(() =>
    apiFetch<{ lead: Lead; event: LeadEvent | null }>(`/api/leads/${encodeURIComponent(id)}/stage`, {
      method: 'POST',
      body: JSON.stringify({ stage }),
    }),
  );
}

export async function getLeadEvents(id: string): Promise<LeadEvent[]> {
  const { events } = await apiFetch<{ events: LeadEvent[] }>(`/api/leads/${encodeURIComponent(id)}/events`);
  return events;
}

/** Manual note only — mirrors the server's public events POST, which never
 *  accepts a caller-supplied type/source (see app/api/leads/[id]/events/route.ts). */
export async function appendLeadEvent(id: string, input: { summary: string }): Promise<LeadEvent> {
  const { event } = await apiFetch<{ event: LeadEvent }>(`/api/leads/${encodeURIComponent(id)}/events`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return event;
}

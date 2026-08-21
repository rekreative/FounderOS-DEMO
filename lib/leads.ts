import { getClients, initializeStoreIfNeeded } from '@/lib/clients';

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

export type CreateLeadInput = {
  /** Defaults to 'client' when omitted — preserves every existing call
   * site's prior behavior (a required clientId) without a migration. */
  scope?: LeadScope;
  clientId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
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

const STORAGE_KEY = 'rek_leads_v1';
const EVENTS_STORAGE_KEY = 'rek_lead_events_v1';

function readStorage<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to parse ${key} from localStorage`, error);
    return [];
  }
}

function getStorageRaw(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(key);
}

function writeStorage<T>(key: string, value: T[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to write ${key} to localStorage`, error);
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function assertScopeInvariant(scope: LeadScope, clientId: string | null): void {
  if (scope === 'client') {
    if (!clientId) {
      throw new Error('A client-scoped lead requires a clientId');
    }
    if (!getClients().some((client) => client.id === clientId)) {
      throw new Error('Cannot create lead for a missing client id');
    }
  }
}

/** Safe read-time migration: every Lead persisted before `scope` existed
 * (JSON.parse yields `undefined`) was, by definition, a client lead — this
 * repo had no internal-lead concept until now. Backfilling here means
 * existing seeded/manual data is never rewritten or lost, only the new
 * field is filled in, the same way every time it's read (same pattern as
 * lib/client-integration-requirements.ts's normalizeRequirement). */
function normalizeLead(raw: Lead): Lead {
  if (raw.scope === 'internal' || raw.scope === 'client') return raw;
  return { ...raw, scope: 'client' };
}

function readLeads(): Lead[] {
  return readStorage<Lead>(STORAGE_KEY).map(normalizeLead);
}

function seedLeadEvents(): LeadEvent[] {
  const now = new Date();
  const offset = (days: number, hours: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    d.setHours(d.getHours() - hours);
    return d.toISOString();
  };

  return [
    {
      id: 'evt-demo-1',
      leadId: 'lead-demo-1',
      type: 'lead_received',
      source: 'meta',
      occurredAt: offset(3, 2),
      summary: 'Meta instant form submitted',
      details: { campaign: 'Spring Retargeting' },
    },
    {
      id: 'evt-demo-2',
      leadId: 'lead-demo-1',
      type: 'ai_analyzed',
      source: 'openai',
      occurredAt: offset(3, 1),
      summary: 'AI analyzed the lead and marked it warm',
      details: { intent: 'warm', priority: 'high' },
    },
    {
      id: 'evt-demo-3',
      leadId: 'lead-demo-1',
      type: 'whatsapp_sent',
      source: 'whatsapp',
      occurredAt: offset(2, 6),
      summary: 'WhatsApp template sent',
      details: { template: 'lead-responder' },
    },
    {
      id: 'evt-demo-4',
      leadId: 'lead-demo-1',
      type: 'lead_replied',
      source: 'whatsapp',
      occurredAt: offset(1, 3),
      summary: 'Lead replied asking for pricing',
      details: null,
    },
    {
      id: 'evt-demo-5',
      leadId: 'lead-demo-1',
      type: 'appointment_booked',
      source: 'crm',
      occurredAt: offset(0, 12),
      summary: 'Discovery call booked',
      details: { appointmentDate: offset(0, 12) },
    },
    {
      id: 'evt-demo-6',
      leadId: 'lead-demo-2',
      type: 'lead_received',
      source: 'meta',
      occurredAt: offset(6, 2),
      summary: 'Meta lead submitted via a lead form',
      details: { campaign: 'New Client Offer' },
    },
    {
      id: 'evt-demo-7',
      leadId: 'lead-demo-2',
      type: 'ai_analyzed',
      source: 'openai',
      occurredAt: offset(5, 20),
      summary: 'AI analysis flagged a likely fit',
      details: { intent: 'hot', priority: 'high' },
    },
    {
      id: 'evt-demo-8',
      leadId: 'lead-demo-2',
      type: 'commercial_contacted',
      source: 'manual',
      occurredAt: offset(5, 8),
      summary: 'Commercial outreach sent by team',
      details: null,
    },
    {
      id: 'evt-demo-9',
      leadId: 'lead-demo-3',
      type: 'lead_received',
      source: 'meta',
      occurredAt: offset(10, 1),
      summary: 'Lead came in from an ad click',
      details: { campaign: 'Retainer Funnel' },
    },
    {
      id: 'evt-demo-10',
      leadId: 'lead-demo-3',
      type: 'whatsapp_sent',
      source: 'whatsapp',
      occurredAt: offset(9, 15),
      summary: 'WhatsApp value proposition sent',
      details: null,
    },
    {
      id: 'evt-demo-11',
      leadId: 'lead-demo-3',
      type: 'stage_changed',
      source: 'system',
      occurredAt: offset(8, 10),
      summary: 'Lead moved to qualified',
      details: { from: 'contacted', to: 'qualified' },
    },
    {
      id: 'evt-demo-12',
      leadId: 'lead-demo-4',
      type: 'lead_received',
      source: 'meta',
      occurredAt: offset(15, 2),
      summary: 'Lead form submitted after homepage CTA',
      details: { campaign: 'Offer page' },
    },
    {
      id: 'evt-demo-13',
      leadId: 'lead-demo-4',
      type: 'ai_analyzed',
      source: 'openai',
      occurredAt: offset(14, 13),
      summary: 'AI found strong service fit',
      details: { intent: 'warm', priority: 'medium' },
    },
    {
      id: 'evt-demo-14',
      leadId: 'lead-demo-4',
      type: 'appointment_completed',
      source: 'crm',
      occurredAt: offset(13, 4),
      summary: 'Consultation completed',
      details: null,
    },
    {
      id: 'evt-demo-15',
      leadId: 'lead-demo-5',
      type: 'lead_received',
      source: 'meta',
      occurredAt: offset(21, 3),
      summary: 'Lead came in from a paid campaign',
      details: { campaign: 'Video Ad' },
    },
    {
      id: 'evt-demo-16',
      leadId: 'lead-demo-5',
      type: 'converted',
      source: 'system',
      occurredAt: offset(18, 10),
      summary: 'Lead converted to paying client',
      details: { value: 4200 },
    },
    // REKREATIVE's own internal acquisition — scope: 'internal', never a
    // client. See lead-internal-1/2 in seedDemoLeads below.
    {
      id: 'evt-internal-1',
      leadId: 'lead-internal-1',
      type: 'lead_received',
      source: 'meta',
      occurredAt: offset(7, 3),
      summary: 'Meta instant form submitted',
      details: { campaign: 'REKREATIVE — Captación Centros de Psicología' },
    },
    {
      id: 'evt-internal-2',
      leadId: 'lead-internal-1',
      type: 'ai_analyzed',
      source: 'openai',
      occurredAt: offset(6, 20),
      summary: 'AI analyzed the lead and marked it warm',
      details: { intent: 'warm', priority: 'high' },
    },
    {
      id: 'evt-internal-3',
      leadId: 'lead-internal-1',
      type: 'commercial_contacted',
      source: 'manual',
      occurredAt: offset(6, 4),
      summary: 'Commercial outreach sent by team',
      details: null,
    },
    {
      id: 'evt-internal-4',
      leadId: 'lead-internal-1',
      type: 'stage_changed',
      source: 'system',
      occurredAt: offset(1, 4),
      summary: 'Lead moved to qualified',
      details: { from: 'contacted', to: 'qualified' },
    },
    {
      id: 'evt-internal-5',
      leadId: 'lead-internal-2',
      type: 'lead_received',
      source: 'meta',
      occurredAt: offset(2, 1),
      summary: 'Meta instant form submitted',
      details: { campaign: 'REKREATIVE — Captación Centros de Psicología' },
    },
  ];
}

function seedDemoLeads(): Lead[] {
  const now = new Date();
  const daysAgo = (days: number, hours = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    d.setHours(d.getHours() - hours);
    return d.toISOString();
  };

  return [
    {
      id: 'lead-demo-1',
      scope: 'client',
      clientId: 'client-acme',
      name: 'Maya Chen',
      email: 'maya.chen@example.com',
      phone: '+1 415 555 1010',
      whatsapp: '+1 415 555 1010',
      source: 'Meta Ads',
      campaign: 'Spring Retargeting',
      adCreative: 'Consulting funnel V2',
      form: 'Website instant form',
      stage: 'appointment',
      createdAt: daysAgo(3),
      lastActivityAt: daysAgo(0, 12),
      aiAnalysis: {
        summary: 'Warm fit for growth consulting. Asked for pricing and wants a call within 48 hours.',
        intent: 'warm',
        priority: 'high',
        qualification: {
          pain: 'Not enough qualified leads',
          urgency: 'High',
        },
        analyzedAt: daysAgo(2, 20),
      },
      qualificationAnswers: {
        challenge: 'Need more qualified pipeline',
        budget: 'Open to a scoped package',
      },
      appointmentDate: daysAgo(0, 12),
      conversionValue: null,
    },
    {
      id: 'lead-demo-2',
      scope: 'client',
      clientId: 'client-lumen',
      name: 'Nora Singh',
      email: 'nora@lumen.example.com',
      phone: '+1 415 555 2020',
      whatsapp: '+1 415 555 2020',
      source: 'Organic',
      campaign: 'Brand discovery',
      adCreative: 'Organic profile visit',
      form: 'Landing page CTA',
      stage: 'qualified',
      createdAt: daysAgo(6),
      lastActivityAt: daysAgo(5, 8),
      aiAnalysis: {
        summary: 'Strong fit for a small creative retainer with clear moodboard and launch goals.',
        intent: 'hot',
        priority: 'high',
        qualification: {
          fit: 'Strong',
          urgency: 'Medium',
        },
        analyzedAt: daysAgo(5, 20),
      },
      qualificationAnswers: {
        budget: 'Medium',
        timeline: 'Within 2 weeks',
      },
      appointmentDate: null,
      conversionValue: null,
    },
    {
      id: 'lead-demo-3',
      scope: 'client',
      clientId: 'client-northwind',
      name: 'Adrian Brooks',
      email: 'adrian@northwind.example.com',
      phone: '+1 415 555 3030',
      whatsapp: '+1 415 555 3030',
      source: 'Paid Search',
      campaign: 'Retainer Funnel',
      adCreative: 'Landing page',
      form: 'Lead capture form',
      stage: 'contacted',
      createdAt: daysAgo(10),
      lastActivityAt: daysAgo(8, 10),
      aiAnalysis: {
        summary: 'Potential fit but needs an additional qualification call before committing.',
        intent: 'warm',
        priority: 'medium',
        qualification: {
          salesCycle: '6-8 weeks',
          needs: 'Multi-channel growth',
        },
        analyzedAt: daysAgo(9, 15),
      },
      qualificationAnswers: {
        goal: 'Scale inbound pipeline',
      },
      appointmentDate: null,
      conversionValue: null,
    },
    {
      id: 'lead-demo-4',
      scope: 'client',
      clientId: 'client-acme',
      name: 'Elliot Price',
      email: 'elliot@acme.example.com',
      phone: '+1 415 555 4040',
      whatsapp: '+1 415 555 4040',
      source: 'Referral',
      campaign: 'Partner referral',
      adCreative: null,
      form: 'Manual intake',
      stage: 'converted',
      createdAt: daysAgo(15),
      lastActivityAt: daysAgo(13, 4),
      aiAnalysis: {
        summary: 'Strong commercial fit and ready to buy with a clear budget.',
        intent: 'hot',
        priority: 'high',
        qualification: {
          readiness: 'Very high',
          fit: 'Strong',
        },
        analyzedAt: daysAgo(14, 13),
      },
      qualificationAnswers: {
        budget: 'High',
        active: 'Yes',
      },
      appointmentDate: daysAgo(13, 4),
      conversionValue: 4200,
    },
    {
      id: 'lead-demo-5',
      scope: 'client',
      clientId: 'client-lumen',
      name: 'Harper Ross',
      email: 'harper@lumen.example.com',
      phone: '+1 415 555 5050',
      whatsapp: '+1 415 555 5050',
      source: 'Meta Ads',
      campaign: 'Video Ad',
      adCreative: 'Launch offer reel',
      form: 'Instant form',
      stage: 'new',
      createdAt: daysAgo(21),
      lastActivityAt: daysAgo(18, 10),
      aiAnalysis: null,
      qualificationAnswers: null,
      appointmentDate: null,
      conversionValue: null,
    },
    // REKREATIVE's own internal acquisition — prospects for REKREATIVE
    // itself (psychology centers/professionals interested in REKREATIVE's
    // marketing services), never a client. scope: 'internal', clientId:
    // null. Kept small and credible — 2 leads, not a full pipeline.
    {
      id: 'lead-internal-1',
      scope: 'internal',
      clientId: null,
      name: 'Dra. Carla Méndez',
      email: 'carla.mendez@centropsique.example.com',
      phone: '+34 611 222 333',
      whatsapp: '+34 611 222 333',
      source: 'Meta Ads',
      campaign: 'REKREATIVE — Captación Centros de Psicología',
      adCreative: 'Anuncio de captación para consultas de psicología',
      form: 'Formulario instantáneo REKREATIVE',
      stage: 'qualified',
      createdAt: daysAgo(7),
      lastActivityAt: daysAgo(1, 4),
      aiAnalysis: {
        summary: 'Dirige un centro de psicología con 4 profesionales y busca más pacientes de terapia individual.',
        intent: 'warm',
        priority: 'high',
        qualification: {
          pain: 'Pocas consultas nuevas al mes',
          urgency: 'Media',
        },
        analyzedAt: daysAgo(6, 20),
      },
      qualificationAnswers: {
        servicio: 'Terapia individual y de pareja',
        presupuesto: 'Abierta a un paquete mensual',
      },
      appointmentDate: null,
      conversionValue: null,
    },
    {
      id: 'lead-internal-2',
      scope: 'internal',
      clientId: null,
      name: 'Javier Roldán',
      email: 'javier@institutobienestar.example.com',
      phone: '+34 622 444 555',
      whatsapp: null,
      source: 'Meta Ads',
      campaign: 'REKREATIVE — Captación Centros de Psicología',
      adCreative: 'Anuncio de captación para consultas de psicología',
      form: 'Formulario instantáneo REKREATIVE',
      stage: 'new',
      createdAt: daysAgo(2),
      lastActivityAt: daysAgo(2),
      aiAnalysis: null,
      qualificationAnswers: null,
      appointmentDate: null,
      conversionValue: null,
    },
  ];
}

export function initializeLeadsStoreIfNeeded(): Lead[] {
  if (typeof window === 'undefined') {
    return seedDemoLeads();
  }

  const leadsRaw = getStorageRaw(STORAGE_KEY);
  const eventsRaw = getStorageRaw(EVENTS_STORAGE_KEY);

  if (!leadsRaw) {
    const seeded = seedDemoLeads();
    writeStorage(STORAGE_KEY, seeded);
    const events = seedLeadEvents();
    writeStorage(EVENTS_STORAGE_KEY, events);
    return seeded;
  }

  let existing: Lead[] = [];
  try {
    const parsed = JSON.parse(leadsRaw);
    existing = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Failed to parse leads from localStorage; leaving existing store intact.', error);
  }

  if (!eventsRaw) {
    const seededEvents = seedLeadEvents().filter((event) => existing.some((lead) => lead.id === event.leadId));
    writeStorage(EVENTS_STORAGE_KEY, seededEvents);
    return existing;
  }

  try {
    const parsedEvents = JSON.parse(eventsRaw);
    if (!Array.isArray(parsedEvents)) {
      const seededEvents = seedLeadEvents().filter((event) => existing.some((lead) => lead.id === event.leadId));
      writeStorage(EVENTS_STORAGE_KEY, seededEvents);
    }
  } catch (error) {
    console.error('Failed to parse lead events from localStorage; reinitializing the event store safely.', error);
    const seededEvents = seedLeadEvents().filter((event) => existing.some((lead) => lead.id === event.leadId));
    writeStorage(EVENTS_STORAGE_KEY, seededEvents);
  }

  return existing.length ? existing : seedDemoLeads();
}

/** No clientId → every lead (internal + client — see LEADS-scope filtering
 * in app/leads/page.tsx). A clientId → only that client's own leads (never
 * internal, never another client's) — the exact contract Client Workspace's
 * ClientLeadsPanel relies on for isolation. */
export function getLeads(clientId?: string): Lead[] {
  const leads = readLeads();
  const result = !clientId ? leads : leads.filter((lead) => lead.clientId === clientId);
  return result.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
}

export function getLeadById(id: string): Lead | null {
  return readLeads().find((lead) => lead.id === id) ?? null;
}

export function getLeadEvents(leadId: string): LeadEvent[] {
  return readStorage<LeadEvent>(EVENTS_STORAGE_KEY)
    .filter((event) => event.leadId === leadId)
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
}

export function appendLeadEvent(
  leadId: string,
  input: {
    type: LeadEventType;
    source: LeadEventSource;
    summary: string;
    details?: Record<string, unknown> | null;
    occurredAt?: string;
  },
): LeadEvent {
  const events = readStorage<LeadEvent>(EVENTS_STORAGE_KEY);
  const occurredAt = input.occurredAt ?? isoNow();
  const created: LeadEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    leadId,
    type: input.type,
    source: input.source,
    occurredAt,
    summary: input.summary,
    details: input.details ?? null,
  };

  const nextEvents = [...events, created];
  writeStorage(EVENTS_STORAGE_KEY, nextEvents);

  const leads = readLeads();
  const leadIndex = leads.findIndex((lead) => lead.id === leadId);
  if (leadIndex >= 0) {
    const lead = leads[leadIndex];
    const updatedLead = { ...lead, lastActivityAt: new Date(occurredAt) > new Date(lead.lastActivityAt) ? occurredAt : lead.lastActivityAt };
    leads[leadIndex] = updatedLead;
    writeStorage(STORAGE_KEY, leads);
  }

  return created;
}

export function createLead(input: CreateLeadInput): Lead {
  const scope: LeadScope = input.scope ?? 'client';
  const clientId = scope === 'client' ? input.clientId ?? null : null;
  assertScopeInvariant(scope, clientId);

  const now = isoNow();
  const created: Lead = {
    id: `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scope,
    clientId,
    name: input.name.trim(),
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    whatsapp: input.whatsapp?.trim() || null,
    source: input.source?.trim() || 'Manual',
    campaign: input.campaign?.trim() || null,
    adCreative: input.adCreative?.trim() || null,
    form: input.form?.trim() || null,
    stage: input.stage ?? 'new',
    createdAt: now,
    lastActivityAt: now,
    aiAnalysis: input.aiAnalysis ?? null,
    qualificationAnswers: input.qualificationAnswers ?? null,
    appointmentDate: input.appointmentDate ?? null,
    conversionValue: input.conversionValue ?? null,
  };

  const leads = readLeads();
  const nextLeads = [created, ...leads];
  writeStorage(STORAGE_KEY, nextLeads);

  appendLeadEvent(created.id, {
    type: 'lead_received',
    source: 'manual',
    summary: `${created.name} was added to the REKREATIVE CRM`,
    occurredAt: now,
    details: { source: created.source, campaign: created.campaign },
  });

  return created;
}

/** clientId/scope are deliberately excluded — the only way they may change
 * is together, through updateLead's own merge below, which re-enforces the
 * scope invariant on every write (same single-writer discipline as
 * lib/content-items.ts's updateContentItem). stage stays excluded too —
 * setLeadStage is the only writer, so a stage_changed LeadEvent is never
 * skipped. */
export type UpdateLeadInput = Partial<Omit<Lead, 'id' | 'createdAt' | 'stage'>>;

export function updateLead(id: string, patch: UpdateLeadInput): Lead | null {
  const leads = readLeads();
  const leadIndex = leads.findIndex((lead) => lead.id === id);
  if (leadIndex === -1) {
    return null;
  }

  const existing = leads[leadIndex];
  const merged: Lead = {
    ...existing,
    ...patch,
    lastActivityAt: patch.lastActivityAt ?? existing.lastActivityAt,
  };

  if (merged.scope === 'internal') {
    merged.clientId = null;
  } else {
    assertScopeInvariant(merged.scope, merged.clientId);
  }

  leads[leadIndex] = merged;
  writeStorage(STORAGE_KEY, leads);
  return merged;
}

export function setLeadStage(leadId: string, nextStage: LeadStage, source: LeadEventSource = 'manual'): Lead | null {
  const lead = getLeadById(leadId);
  if (!lead) return null;
  if (lead.stage === nextStage) return lead;

  const leads = readLeads();
  const leadIndex = leads.findIndex((item) => item.id === leadId);
  if (leadIndex === -1) return null;

  const occurredAt = isoNow();
  const updated = {
    ...leads[leadIndex],
    stage: nextStage,
  };
  leads[leadIndex] = updated;
  writeStorage(STORAGE_KEY, leads);

  appendLeadEvent(leadId, {
    type: 'stage_changed',
    source,
    summary: `Stage changed to ${LEAD_STAGE_OPTIONS.find((option) => option.id === nextStage)?.label ?? nextStage}`,
    occurredAt,
    details: { from: lead.stage, to: nextStage },
  });

  return getLeadById(leadId);
}

export function setAIAnalysis(leadId: string, analysis: LeadAiAnalysis | null): Lead | null {
  const leads = readLeads();
  const leadIndex = leads.findIndex((lead) => lead.id === leadId);
  if (leadIndex === -1) return null;

  const existing = leads[leadIndex];
  const nextAnalysis: LeadAiAnalysis | null = analysis
    ? {
        summary: analysis.summary ?? null,
        intent: analysis.intent ?? null,
        priority: analysis.priority ?? null,
        qualification: analysis.qualification ?? null,
        analyzedAt: analysis.analyzedAt ?? isoNow(),
      }
    : null;

  const updatedLead: Lead = {
    ...existing,
    aiAnalysis: nextAnalysis,
  };

  leads[leadIndex] = updatedLead;
  writeStorage(STORAGE_KEY, leads);

  return updatedLead;
}

export function getClientNameForLead(clientId: string | null): string {
  if (!clientId) return 'Interno';
  const client = getClients().find((item) => item.id === clientId);
  return client?.name ?? 'Cliente desconocido';
}

export function getStageLabel(stage: LeadStage): string {
  return LEAD_STAGE_OPTIONS.find((option) => option.id === stage)?.label ?? stage;
}

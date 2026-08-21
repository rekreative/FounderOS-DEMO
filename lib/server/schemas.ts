import { z } from 'zod';

/**
 * Zod request/response-shape validation for the Backend V1 HTTP boundary
 * (Clients, Leads, LeadEvents) — same "validate every boundary" discipline
 * as lib/schemas.ts, kept in lib/server/ since these validate HTTP request
 * bodies/query params rather than DB rows out of the legacy SQLite layer.
 * Cross-field business rules (does this clientId actually exist? is scope
 * consistent with clientId?) are NOT modeled here — those are domain
 * invariants enforced by lib/server/leads-repo.ts's assertScopeInvariant
 * and surfaced as 422, not 400. Zod here only validates shape/format.
 */

export const ClientStatusSchema = z.enum(['active', 'paused', 'prospect']);
export const LeadScopeSchema = z.enum(['internal', 'client']);
export const LeadStageSchema = z.enum([
  'new',
  'contacted',
  'qualified',
  'appointment',
  'converted',
  'no_response',
  'disqualified',
]);
export const LeadIntentSchema = z.enum(['cold', 'warm', 'hot']);
export const LeadPrioritySchema = z.enum(['low', 'medium', 'high']);
export const LeadEventTypeSchema = z.enum([
  'lead_received',
  'ai_analyzed',
  'whatsapp_sent',
  'whatsapp_delivered',
  'lead_replied',
  'commercial_contacted',
  'appointment_booked',
  'appointment_completed',
  'converted',
  'disqualified',
  'manual_note',
  'stage_changed',
]);
export const LeadEventSourceSchema = z.enum(['meta', 'openai', 'whatsapp', 'make', 'manual', 'crm', 'system']);

const isoDateTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid date-time string');

export const CreateClientBodySchema = z
  .object({
    name: z.string().trim().min(1),
    sector: z.string().trim().min(1),
    status: ClientStatusSchema,
    service: z.string().trim().min(1),
    metaBudgetMonthly: z.number().finite().nonnegative(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD'),
    owner: z.string().trim().min(1),
  })
  .strict();

export const UpdateClientBodySchema = CreateClientBodySchema.partial();

const leadAiAnalysisSchema = z
  .object({
    summary: z.string().nullable(),
    intent: LeadIntentSchema.nullable(),
    priority: LeadPrioritySchema.nullable(),
    qualification: z.record(z.string()).nullable(),
    analyzedAt: isoDateTime.nullable(),
  })
  .strict();

export const CreateLeadBodySchema = z
  .object({
    scope: LeadScopeSchema,
    clientId: z.string().trim().min(1).nullable().optional(),
    name: z.string().trim().min(1),
    email: z.string().trim().email().nullable().optional(),
    phone: z.string().trim().min(1).nullable().optional(),
    whatsapp: z.string().trim().min(1).nullable().optional(),
    source: z.string().trim().min(1).optional(),
    campaign: z.string().trim().min(1).nullable().optional(),
    adCreative: z.string().trim().min(1).nullable().optional(),
    form: z.string().trim().min(1).nullable().optional(),
    stage: LeadStageSchema.optional(),
    aiAnalysis: leadAiAnalysisSchema.nullable().optional(),
    qualificationAnswers: z.record(z.string()).nullable().optional(),
    appointmentDate: isoDateTime.nullable().optional(),
    conversionValue: z.number().finite().nonnegative().nullable().optional(),
  })
  .strict();

// Business fields only — no scope/clientId/stage. See UpdateLeadInput in
// lib/server/leads-repo.ts for why: PATCH must never bypass the dedicated
// stage endpoint's event semantics, and re-scoping a lead isn't a Backend V1
// use case yet.
export const UpdateLeadBodySchema = z
  .object({
    name: z.string().trim().min(1),
    email: z.string().trim().email().nullable(),
    phone: z.string().trim().min(1).nullable(),
    whatsapp: z.string().trim().min(1).nullable(),
    source: z.string().trim().min(1),
    campaign: z.string().trim().min(1).nullable(),
    adCreative: z.string().trim().min(1).nullable(),
    form: z.string().trim().min(1).nullable(),
    aiAnalysis: leadAiAnalysisSchema.nullable(),
    qualificationAnswers: z.record(z.string()).nullable(),
    appointmentDate: isoDateTime.nullable(),
    conversionValue: z.number().finite().nonnegative().nullable(),
  })
  .strict()
  .partial();

export const ListLeadsQuerySchema = z
  .object({
    clientId: z.string().trim().min(1).optional(),
    scope: LeadScopeSchema.optional(),
  })
  .strict();

export const StageChangeBodySchema = z
  .object({
    stage: LeadStageSchema,
  })
  .strict();

// Public note-only surface — never accepts caller-supplied type/source, so
// the browser can't spoof an automated event (whatsapp_sent, converted, …).
// The route hardcodes type: 'manual_note', source: 'manual'.
export const AppendManualEventBodySchema = z
  .object({
    summary: z.string().trim().min(1),
  })
  .strict();

// Ingestion (Make → REKREATIVE OS) doesn't supply analyzedAt — that's set
// server-side only when a real AI qualification pass runs, not this pass.
const ingestLeadAiAnalysisSchema = z
  .object({
    summary: z.string().trim().min(1).nullable().optional(),
    intent: LeadIntentSchema.nullable().optional(),
    priority: LeadPrioritySchema.nullable().optional(),
    qualification: z.record(z.string()).nullable().optional(),
  })
  .strict();

/**
 * POST /api/ingest/leads request shape. Deliberately has NO `stage` field —
 * Make must never choose a lead's lifecycle state; every ingested lead
 * starts at the repository's own default ('new'), and `.strict()` rejects
 * the key outright if a caller sends one. clientId's existence and the
 * scope/clientId invariant are NOT checked here — those are domain
 * invariants enforced by leads-repo.ts's assertScopeInvariant (422), not
 * shape validation (400).
 */
export const IngestLeadBodySchema = z
  .object({
    deliveryId: z.string().trim().min(1),
    ingestionSource: z.string().trim().min(1),
    externalLeadId: z.string().trim().min(1).nullable().optional(),
    leadSource: z.string().trim().min(1),
    scope: LeadScopeSchema,
    clientId: z.string().trim().min(1).nullable().optional(),
    name: z.string().trim().min(1),
    email: z.string().trim().email().nullable().optional(),
    phone: z.string().trim().min(1).nullable().optional(),
    whatsapp: z.string().trim().min(1).nullable().optional(),
    campaign: z.string().trim().min(1).nullable().optional(),
    adCreative: z.string().trim().min(1).nullable().optional(),
    form: z.string().trim().min(1).nullable().optional(),
    qualificationAnswers: z.record(z.string()).nullable().optional(),
    aiAnalysis: ingestLeadAiAnalysisSchema.nullable().optional(),
  })
  .strict();

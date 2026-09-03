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

const BusinessTextItemSchema = z.string().trim().min(1).max(100);

const InternalBusinessProfileBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(4000),
    ownerName: z.string().trim().min(1).max(120),
    timezone: z.string().trim().min(1).max(100),
    currency: z.string().trim().regex(/^[A-Z]{3}$/),
    monthlyRevenueTarget: z.number().finite().nonnegative(),
    monthlyNewClientsMin: z.number().int().nonnegative(),
    monthlyNewClientsTarget: z.number().int().nonnegative(),
    monthlyNewClientsMax: z.number().int().nonnegative(),
    monthlyLeadsMin: z.number().int().nonnegative(),
    monthlyLeadsTarget: z.number().int().nonnegative(),
    monthlyLeadsMax: z.number().int().nonnegative(),
    monthlyAppointmentsTarget: z.number().int().nonnegative(),
    acquisitionChannels: z.array(BusinessTextItemSchema).max(20),
    tools: z.array(BusinessTextItemSchema).max(30),
    commercialPolicy: z.string().trim().min(1).max(4000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!(value.monthlyNewClientsMin <= value.monthlyNewClientsTarget && value.monthlyNewClientsTarget <= value.monthlyNewClientsMax)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['monthlyNewClientsTarget'], message: 'new-client targets must be ordered min <= target <= max' });
    }
    if (!(value.monthlyLeadsMin <= value.monthlyLeadsTarget && value.monthlyLeadsTarget <= value.monthlyLeadsMax)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['monthlyLeadsTarget'], message: 'lead targets must be ordered min <= target <= max' });
    }
  });

const InternalBusinessServiceBodySchema = z
  .object({
    id: z.string().trim().min(1).max(160).optional(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).nullable(),
    price: z.number().finite().nonnegative(),
    billingType: z.enum(['one_off', 'monthly']),
    allowTwoPayments: z.boolean(),
    secondPaymentTrigger: z.string().trim().min(1).max(500).nullable(),
    active: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.allowTwoPayments && (value.billingType !== 'one_off' || !value.secondPaymentTrigger)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['secondPaymentTrigger'], message: 'two-payment services require a one-off billing type and a second-payment trigger' });
    }
    if (!value.allowTwoPayments && value.secondPaymentTrigger != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['secondPaymentTrigger'], message: 'a second-payment trigger requires two payments' });
    }
  });

export const SaveInternalBusinessWorkspaceBodySchema = z
  .object({
    profile: InternalBusinessProfileBodySchema,
    services: z.array(InternalBusinessServiceBodySchema).max(50),
  })
  .strict();
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

// WhatsApp event types Make may report — a deliberate subset of
// LeadEventTypeSchema. `source` is NOT part of this body: it's derived
// server-side from `type` (see app/api/leads/whatsapp-events/route.ts),
// never caller-supplied, so a request can't spoof provenance the same way
// a caller-supplied `stage` could bypass setLeadStage's event semantics.
export const WhatsAppEventTypeSchema = z.enum(['whatsapp_sent', 'whatsapp_delivered', 'lead_replied']);

const whatsAppEventCommonFields = {
  type: WhatsAppEventTypeSchema,
  // The provider (WhatsApp Business Cloud) message id — the idempotency
  // key, paired with `type` (see the lead_events_type_external_id_unique
  // partial index: the same message id legitimately produces both a
  // whatsapp_sent and a later whatsapp_delivered event).
  externalEventId: z.string().trim().min(1),
  summary: z.string().trim().min(1).optional(),
  occurredAt: isoDateTime.optional(),
  details: z.record(z.unknown()).optional(),
};

/**
 * POST /api/leads/whatsapp-events request shape. Exactly one of `leadId`
 * (outbound — Make already has this from POST /api/ingest/leads' response)
 * or the tenant-aware inbound identity (`whatsappNumber`, `phoneNumberId`,
 * and `occurredAt`) is accepted. Ownership is never caller-controlled.
 */
export const WhatsAppEventBodySchema = z.discriminatedUnion('type', [
  z
    .object({
      ...whatsAppEventCommonFields,
      type: z.literal('whatsapp_sent'),
      leadId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      ...whatsAppEventCommonFields,
      type: z.literal('whatsapp_delivered'),
      leadId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      ...whatsAppEventCommonFields,
      type: z.literal('lead_replied'),
      whatsappNumber: z.string().trim().min(1),
      phoneNumberId: z.string().trim().regex(/^\d+$/, 'phoneNumberId must contain digits only'),
      wabaId: z.string().trim().regex(/^\d+$/, 'wabaId must contain digits only').optional(),
      occurredAt: isoDateTime,
    })
    .strict(),
]);

// WhatsApp business number ownership. Phone Number ID and ownership are
// immutable; a transfer closes one interval and creates a new mapping.
export const WhatsAppOwnerScopeSchema = z.enum(['internal', 'client']);

export const CreateWhatsAppBusinessNumberBodySchema = z
  .object({
    ownerScope: WhatsAppOwnerScopeSchema,
    clientId: z.string().trim().min(1).nullable().optional(),
    phoneNumberId: z.string().trim().regex(/^\d+$/, 'phoneNumberId must contain digits only'),
    wabaId: z.string().trim().regex(/^\d+$/, 'wabaId must contain digits only').nullable().optional(),
    displayPhoneNumber: z.string().trim().min(1).nullable().optional(),
    label: z.string().trim().min(1).max(200).nullable().optional(),
    validFrom: isoDateTime.optional(),
    validTo: isoDateTime.nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ownerScope === 'internal' && value.clientId != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: 'clientId must be null for an internal WhatsApp number' });
    }
    if (value.ownerScope === 'client' && !value.clientId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: 'clientId is required for a client WhatsApp number' });
    }
    if (value.validFrom && value.validTo && value.validTo < value.validFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['validTo'], message: 'validTo must not be before validFrom' });
    }
  });

export const UpdateWhatsAppBusinessNumberBodySchema = z
  .object({
    wabaId: z.string().trim().regex(/^\d+$/, 'wabaId must contain digits only').nullable(),
    displayPhoneNumber: z.string().trim().min(1).nullable(),
    label: z.string().trim().min(1).max(200).nullable(),
    validTo: isoDateTime.nullable(),
  })
  .strict()
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'at least one field is required');

export const ListWhatsAppBusinessNumbersQuerySchema = z
  .object({
    ownerScope: WhatsAppOwnerScopeSchema.optional(),
    clientId: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ownerScope === 'internal' && value.clientId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: 'clientId is not valid for internal WhatsApp numbers' });
    }
  });

// Commercial lifecycle event types Make and the manual UI may report — a
// deliberate subset of LeadEventTypeSchema, same convention as
// WhatsAppEventTypeSchema. `source` is NEVER part of either body below: it's
// always hardcoded server-side per route (see
// app/api/leads/commercial-events/route.ts and
// app/api/leads/[id]/commercial-events/route.ts), never caller-supplied —
// same anti-spoofing discipline as WhatsAppEventTypeSchema's own comment.
// Neither body ever carries `stage` either — stage is derived server-side by
// lib/server/leads-repo.ts's appendCommercialEvent.
export const CommercialEventTypeSchema = z.enum([
  'appointment_booked',
  'appointment_completed',
  'converted',
  'disqualified',
]);

const commercialEventSharedFields = {
  summary: z.string().trim().min(1).optional(),
};

/**
 * POST /api/leads/commercial-events request shape (Make). Always addressed
 * by `leadId` — unlike WhatsAppEventBodySchema, there is no
 * phone-number-resolution branch: Make already has a real leadId by the
 * time a booking/commercial workflow reports an event. `externalEventId` is
 * REQUIRED — the durable (type, external_event_id) idempotency key (see
 * lead_events_type_external_id_unique / insertLeadEventIdempotent). Note for
 * Make integrators: externalEventId must identify the semantic occurrence,
 * not just the provider entity — if a calendar provider reuses the same
 * event id across a reschedule, Make must derive a new externalEventId
 * (e.g. providerEventId + kind + start time) so the new appointment_booked
 * isn't incorrectly deduped against the old one. Discriminated on `type` so
 * appointmentDate/conversionValue are required/optional exactly where the
 * domain rules need them (see appendCommercialEvent).
 */
export const CommercialEventBodySchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('appointment_booked'),
      leadId: z.string().trim().min(1),
      externalEventId: z.string().trim().min(1),
      appointmentDate: isoDateTime,
      occurredAt: isoDateTime.optional(),
      details: z.record(z.unknown()).optional(),
      ...commercialEventSharedFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('appointment_completed'),
      leadId: z.string().trim().min(1),
      externalEventId: z.string().trim().min(1),
      occurredAt: isoDateTime.optional(),
      details: z.record(z.unknown()).optional(),
      ...commercialEventSharedFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('converted'),
      leadId: z.string().trim().min(1),
      externalEventId: z.string().trim().min(1),
      conversionValue: z.number().finite().nonnegative().optional(),
      occurredAt: isoDateTime.optional(),
      details: z.record(z.unknown()).optional(),
      ...commercialEventSharedFields,
    })
    .strict(),
  z
    .object({
      type: z.literal('disqualified'),
      leadId: z.string().trim().min(1),
      externalEventId: z.string().trim().min(1),
      occurredAt: isoDateTime.optional(),
      details: z.record(z.unknown()).optional(),
      ...commercialEventSharedFields,
    })
    .strict(),
]);

/**
 * POST /api/leads/[id]/commercial-events request shape (manual UI quick
 * actions). No `leadId` (the URL param identifies the lead), no
 * `externalEventId` (manual actions are never deduped — see
 * appendCommercialEvent's doc comment), no `details` — kept to the smallest
 * surface the Leads UI's quick actions actually need. Same
 * `type`-discriminated shape and the same never-caller-controlled
 * stage/source discipline as the Make schema above.
 */
export const ManualCommercialEventBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('appointment_booked'), appointmentDate: isoDateTime, ...commercialEventSharedFields }).strict(),
  z.object({ type: z.literal('appointment_completed'), ...commercialEventSharedFields }).strict(),
  z
    .object({
      type: z.literal('converted'),
      conversionValue: z.number().finite().nonnegative().optional(),
      ...commercialEventSharedFields,
    })
    .strict(),
  z.object({ type: z.literal('disqualified'), ...commercialEventSharedFields }).strict(),
]);

/**
 * POST /api/ingest/leads request shape. Deliberately has NO `stage` field —
 * Make must never choose a lead's lifecycle state; every ingested lead
 * starts at the repository's own default ('new'), and `.strict()` rejects
 * the key outright if a caller sends one. clientId's existence and the
 * scope/clientId invariant are NOT checked here — those are domain
 * invariants enforced by leads-repo.ts's assertScopeInvariant (422), not
 * shape validation (400).
 */
// Results Real + Home Real V1 (lib/server/results-repo.ts,
// app/api/results/route.ts, app/api/results/home/route.ts). Query params
// only — every field arrives as a string off URLSearchParams, same
// convention as ListLeadsQuerySchema; numeric-looking fields (limit/days)
// stay strings here and are Number()-converted in the route handler after
// validation, not coerced inside Zod, matching how this file validates every
// other query param.
export const ResultsPeriodPresetSchema = z.enum(['all', 'this_month', 'last_month', 'last_30_days', 'custom']);

export const ResultsQuerySchema = z
  .object({
    clientId: z.string().trim().min(1).optional(),
    preset: ResultsPeriodPresetSchema.optional(),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start must be YYYY-MM-DD').optional(),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end must be YYYY-MM-DD').optional(),
  })
  .strict();

export const ResultsHomeQuerySchema = z
  .object({
    limit: z.string().regex(/^\d+$/, 'limit must be a positive integer').optional(),
    days: z.string().regex(/^\d+$/, 'days must be a positive integer').optional(),
  })
  .strict();

// Results Manual Revenue V1 — unlike ResultsQuerySchema, clientId is
// REQUIRED here: there is no global/all-clients manual revenue view (the
// ledger only ever renders on one client's own dashboard), so omitting it is
// a 400, not a fallback to every client's records.
export const ListRevenueRecordsQuerySchema = z
  .object({
    clientId: z.string().trim().min(1),
  })
  .strict();

export const CreateRevenueRecordBodySchema = z
  .object({
    clientId: z.string().trim().min(1),
    amount: z.number().finite().positive(),
    occurredAt: isoDateTime,
    notes: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

// clientId/amount/occurredAt/notes only — source/externalRef/dataSource stay
// system-controlled, and createdBy/updatedBy are never accepted from the
// request body (set server-side from the authenticated user).
export const UpdateRevenueRecordBodySchema = z
  .object({
    clientId: z.string().trim().min(1),
    amount: z.number().finite().positive(),
    occurredAt: isoDateTime,
    notes: z.string().trim().min(1).nullable(),
  })
  .partial()
  .strict();

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
    // Meta Ads Real V1 — additive, optional structured attribution
    // identifiers alongside the free-text campaign/adCreative/form above.
    // Meta's Lead Ads webhook (and Make's Lead Ads trigger module) surfaces
    // these on every lead at no extra cost; they're never required, so
    // every existing Make delivery that omits them keeps working unchanged.
    metaCampaignId: z.string().trim().min(1).nullable().optional(),
    metaAdsetId: z.string().trim().min(1).nullable().optional(),
    metaAdId: z.string().trim().min(1).nullable().optional(),
    metaFormId: z.string().trim().min(1).nullable().optional(),
    qualificationAnswers: z.record(z.string()).nullable().optional(),
    aiAnalysis: ingestLeadAiAnalysisSchema.nullable().optional(),
  })
  .strict();

// ── Meta Ads Real V1 ───────────────────────────────────────────────────────
// client_meta_accounts (canonical clientId <-> Meta ad account mapping),
// meta_sync_runs, and meta_campaign_daily_metrics — see
// lib/server/migrations/0004_meta_ads_real_v1.sql.

export const MetaAccountOwnerScopeSchema = z.enum(['internal', 'client']);

export const CreateClientMetaAccountBodySchema = z
  .object({
    ownerScope: MetaAccountOwnerScopeSchema.default('client'),
    clientId: z.string().trim().min(1).nullable().optional(),
    metaAdAccountId: z.string().trim().min(1),
    metaPageId: z.string().trim().min(1).nullable().optional(),
    metaFormIds: z.array(z.string().trim().min(1)).nullable().optional(),
    label: z.string().trim().min(1).nullable().optional(),
    active: z.boolean().optional(),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validFrom must be YYYY-MM-DD').optional(),
    validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validTo must be YYYY-MM-DD').nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ownerScope === 'internal' && value.clientId != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: 'clientId must be null for an internal Meta account' });
    }
    if (value.ownerScope === 'client' && !value.clientId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: 'clientId is required for a client Meta account' });
    }
    if (value.validFrom && value.validTo && value.validTo < value.validFrom) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['validTo'], message: 'validTo must not be before validFrom' });
    }
  });

// clientId and metaAdAccountId define the mapping's identity — never
// re-pointed by an update; only the account's own metadata and active flag
// change here. To re-map a client to a different ad account, deactivate the
// old row and create a new one (preserves history instead of overwriting it).
export const UpdateClientMetaAccountBodySchema = z
  .object({
    metaPageId: z.string().trim().min(1).nullable(),
    metaFormIds: z.array(z.string().trim().min(1)).nullable(),
    label: z.string().trim().min(1).nullable(),
    active: z.boolean(),
    validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validTo must be YYYY-MM-DD').nullable(),
  })
  .strict()
  .partial();

export const ListClientMetaAccountsQuerySchema = z
  .object({
    clientId: z.string().trim().min(1).optional(),
    ownerScope: MetaAccountOwnerScopeSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ownerScope === 'internal' && value.clientId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: 'clientId is not valid for internal Meta accounts' });
    }
  });

const dailyMetricRowSchema = z
  .object({
    metaCampaignId: z.string().trim().min(1),
    campaignName: z.string().trim().min(1),
    status: z.string().trim().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    spend: z.number().finite().nonnegative(),
    impressions: z.number().finite().nonnegative().int(),
    clicks: z.number().finite().nonnegative().int(),
    leads: z.number().finite().nonnegative().int(),
    reach: z.number().finite().nonnegative().int().nullable().optional(),
  })
  .strict();

/**
 * POST /api/ingest/meta-metrics request shape (central Make sync). Payload
 * identifies the client indirectly via metaAdAccountId — resolved
 * server-side against client_meta_accounts — so Make never needs to know
 * REKREATIVE OS's internal clientId, only the Meta account id it's already
 * pulling insights for. `rows` is one daily campaign snapshot per element;
 * a single POST typically carries a trailing window (e.g. the last 7-14
 * days) so Meta's own late attribution corrections land as UPSERTs, not
 * missed updates.
 */
export const IngestMetaMetricsBodySchema = z
  .object({
    metaAdAccountId: z.string().trim().min(1),
    rows: z.array(dailyMetricRowSchema).min(1),
  })
  .strict();

export const MetaAdsCampaignsQuerySchema = z
  .object({
    clientId: z.string().trim().min(1).optional(),
    ownerScope: MetaAccountOwnerScopeSchema.optional(),
    metaAdAccountId: z.string().trim().min(1).optional(),
    preset: ResultsPeriodPresetSchema.optional(),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start must be YYYY-MM-DD').optional(),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'end must be YYYY-MM-DD').optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ownerScope === 'internal' && value.clientId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientId'], message: 'clientId is not valid for internal Meta reporting' });
    }
    if ((value.start && !value.end) || (!value.start && value.end)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['start'], message: 'start and end must be provided together' });
    }
    if (value.preset === 'custom' && (!value.start || !value.end)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['preset'], message: 'custom preset requires start and end' });
    }
    if ((value.start || value.end) && value.preset !== 'custom') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['preset'], message: 'start and end require the custom preset' });
    }
    if (value.start && value.end && value.end < value.start) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'end must not be before start' });
    }
  });

// G-Brain Postgres V1 — preserves the exact current KnowledgeEntry enums
// from lib/knowledge-entries.ts's KNOWLEDGE_*_OPTIONS.
export const KnowledgeScopeSchema = z.enum(['internal', 'client']);
export const KnowledgeTypeSchema = z.enum([
  'decision',
  'learning',
  'sop',
  'strategy',
  'client_context',
  'technical_note',
  'other',
]);
export const KnowledgeSourceSchema = z.enum([
  'manual',
  'client',
  'campaign',
  'meeting',
  'analysis',
  'document',
  'system',
  'other',
]);
export const KnowledgeStatusSchema = z.enum(['active', 'archived']);

// clientId omitted → the global board's contract (internal + every client).
// Given → that client's entries only. Never required, unlike
// ListRevenueRecordsQuerySchema (which has no global view).
export const ListKnowledgeEntriesQuerySchema = z
  .object({
    clientId: z.string().trim().min(1).optional(),
  })
  .strict();

// title/type/source only required — matches the current create form's own
// "title is the only hard-required field" contract. dataSource/createdBy/
// updatedBy/createdAt/updatedAt are deliberately absent: server-controlled,
// never accepted from the request body.
export const CreateKnowledgeEntryBodySchema = z
  .object({
    scope: KnowledgeScopeSchema,
    clientId: z.string().trim().min(1).nullable().optional(),
    title: z.string().trim().min(1),
    type: KnowledgeTypeSchema,
    tags: z.array(z.string()).optional(),
    summary: z.string().optional(),
    content: z.string().optional(),
    source: KnowledgeSourceSchema,
    sourceLabel: z.string().trim().min(1).nullable().optional(),
    status: KnowledgeStatusSchema.optional(),
  })
  .strict();

// Same field set as create, all optional — status is included here (not on
// create) so archive/restore can PATCH it directly. dataSource/createdBy/
// updatedBy/createdAt/updatedAt stay excluded, same as create.
export const UpdateKnowledgeEntryBodySchema = CreateKnowledgeEntryBodySchema.partial();

// ── Connections/Secrets V1 ──────────────────────────────────────────────────
// Preserves the exact current IntegrationConnection enums from
// lib/integration-connections.ts's INTEGRATION_*_OPTIONS.
export const IntegrationConnectionScopeSchema = z.enum(['internal', 'client']);
export const IntegrationConnectionPlatformSchema = z.enum([
  'meta',
  'instagram',
  'whatsapp',
  'make',
  'manychat',
  'openai',
  'anthropic',
  'google_sheets',
  'google_calendar',
  'stripe',
  'paypal',
  'other',
]);
export const IntegrationConnectionRecordStatusSchema = z.enum(['active', 'archived']);
export const IntegrationConnectionVerificationTargetSchema = z.enum(['verified', 'failed', 'not_verified']);

export const ListIntegrationConnectionsQuerySchema = z
  .object({
    clientId: z.string().trim().min(1).optional(),
    status: IntegrationConnectionRecordStatusSchema.optional(),
  })
  .strict();

// No length-cap precedent exists elsewhere in this file (every other repo's
// text columns are unbounded) — these are new, deliberately generous but
// finite bounds so a request body can never be unbounded. name/externalRef/
// externalLabel are short identifiers/labels; notes is free text and gets
// more room.
const IntegrationConnectionNameSchema = z.string().trim().min(1).max(200);
const IntegrationConnectionClientIdSchema = z.string().trim().min(1).max(200);
const IntegrationConnectionRefSchema = z.string().trim().min(1).max(200).nullable();
const IntegrationConnectionNotesSchema = z.string().trim().min(1).max(4000).nullable();

export const CreateIntegrationConnectionBodySchema = z
  .object({
    scope: IntegrationConnectionScopeSchema,
    clientId: IntegrationConnectionClientIdSchema.nullable().optional(),
    platform: IntegrationConnectionPlatformSchema,
    name: IntegrationConnectionNameSchema,
    externalRef: IntegrationConnectionRefSchema.optional(),
    externalLabel: IntegrationConnectionRefSchema.optional(),
    notes: IntegrationConnectionNotesSchema.optional(),
  })
  .strict();

/**
 * PATCH — exactly one mutation family per request, discriminated on `action`:
 * 'edit' (business fields), 'verify' (verification state), or 'archive'
 * (archive state). A caller-supplied id/createdBy/updatedBy/timestamp/
 * dataSource/verificationMethod is structurally impossible to express here
 * (none of the three shapes has such a key), not merely runtime-rejected.
 * The server derives verificationMethod ('manual') and every timestamp —
 * 'verify'/'archive' bodies carry only the target state, never a method or
 * a time. An 'edit' body with no business field beyond `action` is rejected
 * by the superRefine below (an empty PATCH is as ambiguous as a mixed one).
 */
export const UpdateIntegrationConnectionBodySchema = z
  .discriminatedUnion('action', [
    z
      .object({
        action: z.literal('edit'),
        scope: IntegrationConnectionScopeSchema.optional(),
        clientId: IntegrationConnectionClientIdSchema.nullable().optional(),
        platform: IntegrationConnectionPlatformSchema.optional(),
        name: IntegrationConnectionNameSchema.optional(),
        externalRef: IntegrationConnectionRefSchema.optional(),
        externalLabel: IntegrationConnectionRefSchema.optional(),
        notes: IntegrationConnectionNotesSchema.optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal('verify'),
        status: IntegrationConnectionVerificationTargetSchema,
      })
      .strict(),
    z
      .object({
        action: z.literal('archive'),
        status: IntegrationConnectionRecordStatusSchema,
      })
      .strict(),
  ])
  .superRefine((body, ctx) => {
    if (body.action === 'edit' && Object.keys(body).every((key) => key === 'action')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'edit requires at least one business field' });
    }
  });

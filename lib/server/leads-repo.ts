import type { PoolClient } from 'pg';
import {
  LEAD_STAGE_OPTIONS,
  type Lead as LeadBase,
  type LeadAiAnalysis,
  type ConversionPaymentPlan,
  type LeadEvent,
  type LeadEventSource,
  type LeadEventType,
  type LeadIntent,
  type LeadPriority,
  type LeadScope,
  type LeadStage,
} from '@/lib/leads';
import { query, withTransaction } from './db';
import { assessPhoneQuality, normalizePhoneDigits } from '../phone';
import { summarizeLeadCollection } from '../commercial-finance';
import { resolveWhatsAppBusinessNumberOnClient } from './whatsapp-repo';

/**
 * Server-only PostgreSQL repository for Leads + LeadEvents (Backend V1).
 * lib/leads.ts keeps only types/constants (its localStorage functions were
 * removed once every runtime consumer migrated — see the Backend V1 file
 * boundary notes); this repo is the real, Postgres-backed implementation
 * those consumers will call into during UI cutover (not this pass).
 */

export type ServerLead = LeadBase & {
  /** Technical ingestion metadata — always null for manual/API-created leads. */
  ingestionSource: string | null;
  externalLeadId: string | null;
  deliveryId: string | null;
  /** Meta Ads Real V1 — additive, optional structured attribution
   *  identifiers alongside the free-text campaign/adCreative/form on
   *  LeadBase. Always null for manual/API-created leads and for any lead
   *  ingested before this field existed or whose source didn't supply it. */
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaAdId: string | null;
  metaFormId: string | null;
  metaPageId: string | null;
};

export class LeadValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'CLIENT_ID_REQUIRED' | 'CLIENT_ID_NOT_ALLOWED' | 'CLIENT_NOT_FOUND',
  ) {
    super(message);
    this.name = 'LeadValidationError';
  }
}

export class LeadNotFoundError extends Error {
  constructor(id: string) {
    super(`Lead ${id} not found`);
    this.name = 'LeadNotFoundError';
  }
}

export class MetaLeadRoutingError extends Error {
  constructor(
    message: string,
    public readonly code: 'META_FORM_UNMAPPED' | 'META_FORM_AMBIGUOUS' | 'META_OWNER_MISMATCH',
  ) {
    super(message);
    this.name = 'MetaLeadRoutingError';
  }
}

export class CommercialConversionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommercialConversionValidationError';
  }
}

export class LeadStageTransitionError extends Error {
  constructor(
    public readonly from: LeadStage,
    public readonly to: LeadStage,
  ) {
    super(`Lead stage cannot transition from ${from} to ${to}`);
    this.name = 'LeadStageTransitionError';
  }
}

export class CommercialEventIdempotencyConflictError extends Error {
  constructor() {
    super('The commercial event identity is already associated with another lead');
    this.name = 'CommercialEventIdempotencyConflictError';
  }
}

export class LeadPaymentValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const TERMINAL_STAGES: ReadonlySet<LeadStage> = new Set(['converted', 'disqualified']);

function assertStageTransitionAllowed(current: LeadStage, next: LeadStage): void {
  if (TERMINAL_STAGES.has(current) && current !== next) {
    throw new LeadStageTransitionError(current, next);
  }
}

export type CreateLeadInput = {
  scope: LeadScope;
  clientId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  /** Business/acquisition source ("Meta Ads", "Referral", ...) — Lead.source. Defaults 'Manual'. */
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

/**
 * Business fields only. scope/clientId are permanent once a lead is
 * created in this pass — deliberately smaller than lib/leads.ts's old
 * localStorage UpdateLeadInput, which allowed re-scoping a lead; that
 * re-validation path isn't needed for the Backend V1 milestone and would
 * add a second invariant-checking branch for no exercised use case yet.
 * stage is excluded on purpose: PATCH must never bypass the dedicated
 * stage-change endpoint's event semantics (see setLeadStage).
 */
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
  /** Inclusive lower bound on leads.created_at — Results V1's acquisition-
   * cohort filter (lib/server/results-repo.ts). Omitted = unbounded. */
  createdFrom?: Date;
  /** Exclusive upper bound on leads.created_at — pairs with createdFrom. */
  createdTo?: Date;
};

// Exported (not just `type`, the row shape too) so results-repo.ts can build
// its own bounded queries against `leads`/`lead_events` (Home's operational
// widgets need orderings/filters listLeads/listLeadEvents don't offer) while
// still going through the exact same row→domain mapping — one mapping
// implementation, not a second copy.
export type LeadRow = {
  id: string;
  scope: string;
  client_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  lead_source: string;
  campaign: string | null;
  ad_creative: string | null;
  form: string | null;
  stage: string;
  ai_intent: string | null;
  ai_priority: string | null;
  ai_summary: string | null;
  ai_qualification: Record<string, string> | null;
  ai_analyzed_at: Date | null;
  qualification_answers: Record<string, string> | null;
  appointment_date: Date | null;
  conversion_value: string | null;
  conversion_service_id: string | null;
  conversion_service_name: string | null;
  conversion_service_billing_type: string | null;
  conversion_service_standard_price: string | null;
  conversion_payment_plan: string | null;
  conversion_initial_payment: string | null;
  conversion_second_payment_trigger: string | null;
  conversion_recorded_at: Date | null;
  conversion_collected_total: string;
  ingestion_source: string | null;
  external_lead_id: string | null;
  ingest_delivery_id: string | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  meta_form_id: string | null;
  meta_page_id: string | null;
  whatsapp_event_type?: string | null;
  whatsapp_event_occurred_at?: Date | null;
  whatsapp_event_summary?: string | null;
  whatsapp_event_details?: Record<string, unknown> | null;
  created_at: Date;
  last_activity_at: Date;
};

export type LeadEventRow = {
  id: string;
  lead_id: string;
  type: string;
  source: string;
  occurred_at: Date;
  summary: string;
  details: Record<string, unknown> | null;
  external_event_id?: string | null;
  whatsapp_business_number_id?: string | null;
};

export type LeadPaymentSource = 'manual' | 'conversion_initial' | 'stripe' | 'paypal';

export type LeadPayment = {
  id: string;
  leadId: string;
  amount: number;
  occurredAt: string;
  source: LeadPaymentSource;
  externalEventId: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
};

type LeadPaymentRow = {
  id: string;
  lead_id: string;
  amount: string;
  occurred_at: Date;
  source: string;
  external_event_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: Date;
};

function rowToLeadPayment(row: LeadPaymentRow): LeadPayment {
  return {
    id: row.id,
    leadId: row.lead_id,
    amount: Number(row.amount),
    occurredAt: row.occurred_at.toISOString(),
    source: row.source as LeadPaymentSource,
    externalEventId: row.external_event_id,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

export function rowToLead(row: LeadRow): ServerLead {
  const hasAiAnalysis =
    row.ai_intent !== null || row.ai_priority !== null || row.ai_summary !== null || row.ai_qualification !== null || row.ai_analyzed_at !== null;

  const collection = summarizeLeadCollection({
    agreedValue: row.conversion_value === null ? null : Number(row.conversion_value),
    billingType: row.conversion_service_billing_type as 'one_off' | 'monthly' | null,
    amounts: [Number(row.conversion_collected_total ?? 0)],
  });

  return {
    id: row.id,
    scope: row.scope as LeadScope,
    clientId: row.client_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp,
    source: row.lead_source,
    campaign: row.campaign,
    adCreative: row.ad_creative,
    form: row.form,
    stage: row.stage as LeadStage,
    createdAt: row.created_at.toISOString(),
    lastActivityAt: row.last_activity_at.toISOString(),
    aiAnalysis: hasAiAnalysis
      ? {
          summary: row.ai_summary,
          intent: row.ai_intent as LeadIntent | null,
          priority: row.ai_priority as LeadPriority | null,
          qualification: row.ai_qualification,
          analyzedAt: row.ai_analyzed_at ? row.ai_analyzed_at.toISOString() : null,
        }
      : null,
    qualificationAnswers: row.qualification_answers,
    appointmentDate: row.appointment_date ? row.appointment_date.toISOString() : null,
    conversionValue: row.conversion_value === null ? null : Number(row.conversion_value),
    conversionCollection:
      row.conversion_value !== null || Number(row.conversion_collected_total ?? 0) > 0
        ? collection
        : undefined,
    conversionSnapshot:
      row.conversion_service_name && row.conversion_service_billing_type && row.conversion_service_standard_price !== null &&
      row.conversion_payment_plan && row.conversion_initial_payment !== null && row.conversion_recorded_at
        ? {
            serviceId: row.conversion_service_id,
            serviceName: row.conversion_service_name,
            billingType: row.conversion_service_billing_type as 'one_off' | 'monthly',
            standardPrice: Number(row.conversion_service_standard_price),
            paymentPlan: row.conversion_payment_plan as ConversionPaymentPlan,
            initialPayment: Number(row.conversion_initial_payment),
            secondPaymentTrigger: row.conversion_second_payment_trigger,
            recordedAt: row.conversion_recorded_at.toISOString(),
          }
        : null,
    ingestionSource: row.ingestion_source,
    externalLeadId: row.external_lead_id,
    deliveryId: row.ingest_delivery_id,
    metaCampaignId: row.meta_campaign_id,
    metaAdsetId: row.meta_adset_id,
    metaAdId: row.meta_ad_id,
    metaFormId: row.meta_form_id,
    metaPageId: row.meta_page_id,
    phoneQuality: assessPhoneQuality(row.whatsapp ?? row.phone),
    whatsappStatus: {
      state:
        row.whatsapp_event_type === 'whatsapp_failed'
          ? 'failed'
          : row.whatsapp_event_type === 'lead_replied'
            ? 'replied'
            : row.whatsapp_event_type === 'whatsapp_delivered'
              ? 'delivered'
              : row.whatsapp_event_type === 'whatsapp_sent'
                ? 'accepted'
                : 'not_sent',
      occurredAt: row.whatsapp_event_occurred_at?.toISOString() ?? null,
      summary: row.whatsapp_event_summary ?? null,
      errorCode:
        typeof row.whatsapp_event_details?.errorCode === 'string'
          ? row.whatsapp_event_details.errorCode
          : null,
    },
  };
}

export function rowToLeadEvent(row: LeadEventRow): LeadEvent {
  return {
    id: row.id,
    leadId: row.lead_id,
    type: row.type as LeadEventType,
    source: row.source as LeadEventSource,
    occurredAt: row.occurred_at.toISOString(),
    summary: row.summary,
    details: row.details,
  };
}

function generateLeadId(): string {
  return `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateLeadPaymentId(): string {
  return `payment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nullableTrim(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

function stageLabel(stage: LeadStage): string {
  return LEAD_STAGE_OPTIONS.find((option) => option.id === stage)?.label ?? stage;
}

/**
 * The DB CHECK constraint is the ultimate backstop, but repository code
 * validates first so callers get a clean domain error (LeadValidationError,
 * mapped to 422 by the API layer) instead of a raw constraint-violation
 * error. Runs on the transaction's own client so the client existence check
 * sees a consistent snapshot with the insert/update that follows it.
 */
async function assertScopeInvariant(client: PoolClient, scope: LeadScope, clientId: string | null): Promise<void> {
  if (scope === 'client') {
    if (!clientId) throw new LeadValidationError('A client-scoped lead requires a clientId', 'CLIENT_ID_REQUIRED');
    const result = await client.query('SELECT 1 FROM clients WHERE id = $1', [clientId]);
    if (result.rowCount === 0) throw new LeadValidationError('Cannot create lead for a missing client id', 'CLIENT_NOT_FOUND');
  } else if (clientId) {
    throw new LeadValidationError('An internal-scoped lead must not have a clientId', 'CLIENT_ID_NOT_ALLOWED');
  }
}

async function insertLeadEvent(
  client: PoolClient,
  input: {
    leadId: string;
    type: LeadEventType;
    source: LeadEventSource;
    summary: string;
    details?: Record<string, unknown> | null;
    occurredAt: Date;
  },
): Promise<LeadEvent> {
  const id = generateEventId();
  const row = await client.query<LeadEventRow>(
    `INSERT INTO lead_events (id, lead_id, type, source, occurred_at, summary, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, input.leadId, input.type, input.source, input.occurredAt, input.summary, input.details ? JSON.stringify(input.details) : null],
  );
  // Forward-only bump — matches lib/leads.ts's appendLeadEvent exactly
  // (`new Date(occurredAt) > new Date(lead.lastActivityAt) ? occurredAt : lead.lastActivityAt`),
  // just expressed as GREATEST() instead of a JS comparison.
  await client.query('UPDATE leads SET last_activity_at = GREATEST(last_activity_at, $2) WHERE id = $1', [
    input.leadId,
    input.occurredAt,
  ]);
  return rowToLeadEvent(row.rows[0]);
}

/**
 * Idempotent variant for externally-reported events (Make-reported WhatsApp
 * sends/deliveries/replies) that carry a provider message id. Same shape as
 * insertLeadEvent, but ON CONFLICT on (type, external_event_id) — see the
 * lead_events_type_external_id_unique partial index — resolves to the
 * existing row instead of inserting a duplicate. Kept separate from
 * insertLeadEvent rather than adding an optional param to it: every other
 * caller (createLead, setLeadStage, ingestLeadTransactional,
 * appendLeadEvent) never supplies an external_event_id and must always get
 * a freshly inserted row back, never a "maybe undefined" row to guard
 * against.
 */
async function insertLeadEventIdempotent(
  client: PoolClient,
  input: {
    leadId: string;
    type: LeadEventType;
    source: LeadEventSource;
    summary: string;
    details?: Record<string, unknown> | null;
    occurredAt: Date;
    externalEventId: string;
    whatsappBusinessNumberId?: string | null;
  },
): Promise<{ event: LeadEvent; deduped: boolean }> {
  const id = generateEventId();
  const inserted = await client.query<LeadEventRow>(
    `INSERT INTO lead_events (
       id, lead_id, type, source, occurred_at, summary, details,
       external_event_id, whatsapp_business_number_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (type, external_event_id) WHERE external_event_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      id,
      input.leadId,
      input.type,
      input.source,
      input.occurredAt,
      input.summary,
      input.details ? JSON.stringify(input.details) : null,
      input.externalEventId,
      input.whatsappBusinessNumberId ?? null,
    ],
  );

  if (inserted.rowCount && inserted.rowCount > 0) {
    await client.query('UPDATE leads SET last_activity_at = GREATEST(last_activity_at, $2) WHERE id = $1', [
      input.leadId,
      input.occurredAt,
    ]);
    return { event: rowToLeadEvent(inserted.rows[0]), deduped: false };
  }

  // ON CONFLICT DO NOTHING hit — the same (type, externalEventId) already
  // exists (a retried Make/webhook delivery). Resolve to it rather than
  // silently returning nothing.
  const existing = await client.query<LeadEventRow>(
    'SELECT * FROM lead_events WHERE type = $1 AND external_event_id = $2',
    [input.type, input.externalEventId],
  );
  if (existing.rowCount === 0) {
    throw new Error(
      `Idempotent insert conflicted but no existing lead_event found for type=${input.type} externalEventId=${input.externalEventId}`,
    );
  }
  return { event: rowToLeadEvent(existing.rows[0]), deduped: true };
}

/** Inserts a real receipt, maintains the lead-level fast-read projection and
 * puts the financial fact on the existing lead timeline. Always receives the
 * caller's transaction client, so a conversion and its initial receipt can
 * never partially commit. */
async function insertLeadPaymentOnClient(
  client: PoolClient,
  input: {
    leadId: string;
    amount: number;
    occurredAt: Date;
    source: LeadPaymentSource;
    notes?: string | null;
    externalEventId?: string | null;
    createdBy?: string | null;
  },
): Promise<LeadPayment> {
  const id = generateLeadPaymentId();
  const result = await client.query<LeadPaymentRow>(
    `INSERT INTO lead_payments (id, lead_id, amount, occurred_at, source, external_event_id, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, input.leadId, input.amount, input.occurredAt, input.source, input.externalEventId ?? null, nullableTrim(input.notes), input.createdBy ?? null],
  );

  await client.query(
    'UPDATE leads SET conversion_collected_total = conversion_collected_total + $2 WHERE id = $1',
    [input.leadId, input.amount],
  );

  await insertLeadEvent(client, {
    leadId: input.leadId,
    type: 'payment_received',
    source: input.source === 'manual' ? 'manual' : 'system',
    summary: `Cobro registrado · ${input.amount.toLocaleString('es-ES')} €`,
    details: { amount: input.amount, source: input.source, notes: nullableTrim(input.notes) },
    occurredAt: input.occurredAt,
  });

  return rowToLeadPayment(result.rows[0]);
}

export async function listLeads(options: ListLeadsOptions = {}): Promise<ServerLead[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.clientId) {
    params.push(options.clientId);
    conditions.push(`client_id = $${params.length}`);
  }
  if (options.scope) {
    params.push(options.scope);
    conditions.push(`scope = $${params.length}`);
  }
  if (options.createdFrom) {
    params.push(options.createdFrom);
    conditions.push(`l.created_at >= $${params.length}`);
  }
  if (options.createdTo) {
    params.push(options.createdTo);
    conditions.push(`l.created_at < $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<LeadRow>(
    `SELECT l.*,
       wa.type AS whatsapp_event_type,
       wa.occurred_at AS whatsapp_event_occurred_at,
       wa.summary AS whatsapp_event_summary,
       wa.details AS whatsapp_event_details
     FROM leads l
     LEFT JOIN LATERAL (
       SELECT type, occurred_at, summary, details, created_at
       FROM lead_events
       WHERE lead_id = l.id
         AND type IN ('whatsapp_sent', 'whatsapp_delivered', 'whatsapp_failed', 'lead_replied')
       ORDER BY occurred_at DESC, created_at DESC
       LIMIT 1
     ) wa ON true
     ${where}
     ORDER BY l.last_activity_at DESC`,
    params,
  );
  return result.rows.map(rowToLead);
}

export async function getLeadById(id: string): Promise<ServerLead | null> {
  const result = await query<LeadRow>(
    `SELECT l.*,
       wa.type AS whatsapp_event_type,
       wa.occurred_at AS whatsapp_event_occurred_at,
       wa.summary AS whatsapp_event_summary,
       wa.details AS whatsapp_event_details
     FROM leads l
     LEFT JOIN LATERAL (
       SELECT type, occurred_at, summary, details, created_at
       FROM lead_events
       WHERE lead_id = l.id
         AND type IN ('whatsapp_sent', 'whatsapp_delivered', 'whatsapp_failed', 'lead_replied')
       ORDER BY occurred_at DESC, created_at DESC
       LIMIT 1
     ) wa ON true
     WHERE l.id = $1`,
    [id],
  );
  return result.rowCount === 0 ? null : rowToLead(result.rows[0]);
}

export async function listLeadEvents(leadId: string): Promise<LeadEvent[]> {
  const result = await query<LeadEventRow>(
    'SELECT * FROM lead_events WHERE lead_id = $1 ORDER BY occurred_at ASC, created_at ASC, id ASC',
    [leadId],
  );
  return result.rows.map(rowToLeadEvent);
}

/** Complete receipt history for one lead, newest first. This is a ledger,
 * never inferred from stage changes or from the original agreed value. */
export async function listLeadPayments(leadId: string): Promise<LeadPayment[]> {
  const result = await query<LeadPaymentRow>(
    'SELECT * FROM lead_payments WHERE lead_id = $1 ORDER BY occurred_at DESC, created_at DESC, id DESC',
    [leadId],
  );
  return result.rows.map(rowToLeadPayment);
}

/** Manual internal receipt. A financial entry is legal only after an actual
 * conversion, and remains distinct from changing the agreement itself. */
export async function recordLeadPayment(input: {
  leadId: string;
  amount: number;
  occurredAt: string;
  notes?: string | null;
  createdBy: string | null;
}): Promise<{ lead: ServerLead; payment: LeadPayment }> {
  return withTransaction(async (client) => {
    const found = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [input.leadId]);
    if (found.rowCount === 0) throw new LeadNotFoundError(input.leadId);
    const lead = rowToLead(found.rows[0]);
    if (lead.stage !== 'converted') {
      throw new LeadPaymentValidationError('a payment can only be recorded for a converted lead');
    }

    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new LeadPaymentValidationError('payment occurredAt must be a valid date');
    }
    const payment = await insertLeadPaymentOnClient(client, {
      leadId: input.leadId,
      amount: input.amount,
      occurredAt,
      source: 'manual',
      notes: input.notes,
      createdBy: input.createdBy,
    });
    const finalRow = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1', [input.leadId]);
    return { lead: rowToLead(finalRow.rows[0]), payment };
  });
}

/**
 * Every event for a whole set of leads, in ONE bounded query — the
 * Results/Home aggregation layer's replacement for "GET all leads → GET
 * events once per lead" (see lib/server/results-repo.ts). No date filter:
 * Results V1's acquisition-cohort semantics require a lead's FULL event
 * history regardless of when those events occurred, only leads.created_at
 * is ever range-bound. Returns [] without querying for an empty leadIds
 * list — `= ANY($1)` on an empty array is valid SQL but a wasted round trip.
 */
export async function listLeadEventsForLeadIds(leadIds: string[]): Promise<LeadEvent[]> {
  if (leadIds.length === 0) return [];
  const result = await query<LeadEventRow>(
    'SELECT * FROM lead_events WHERE lead_id = ANY($1) ORDER BY occurred_at ASC, created_at ASC, id ASC',
    [leadIds],
  );
  return result.rows.map(rowToLeadEvent);
}

/**
 * Atomic: validate → INSERT lead → INSERT its lead_received event. Preserves
 * the exact current initial-timeline semantics from lib/leads.ts's
 * createLead (type 'lead_received', source 'manual', the same summary/
 * details shape) — moving to Postgres is not a reason to invent a different
 * one for manual/API-created leads.
 */
export async function createLead(input: CreateLeadInput): Promise<{ lead: ServerLead; event: LeadEvent }> {
  // Deliberately NOT coerced to null for scope 'internal' here — that would
  // silently drop a caller-supplied clientId instead of rejecting it.
  // assertScopeInvariant is what turns "internal + a clientId" into a clean
  // CLIENT_ID_NOT_ALLOWED error.
  const clientId = input.clientId ?? null;

  return withTransaction(async (client) => {
    await assertScopeInvariant(client, input.scope, clientId);

    const id = generateLeadId();
    const now = new Date();
    const source = input.source?.trim() || 'Manual';
    const campaign = nullableTrim(input.campaign);

    await client.query(
      `INSERT INTO leads (
         id, scope, client_id, name, email, phone, whatsapp,
         lead_source, campaign, ad_creative, form, stage,
         ai_intent, ai_priority, ai_summary, ai_qualification, ai_analyzed_at,
         qualification_answers, appointment_date, conversion_value,
         created_at, last_activity_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        id,
        input.scope,
        clientId,
        input.name.trim(),
        nullableTrim(input.email),
        nullableTrim(input.phone),
        nullableTrim(input.whatsapp),
        source,
        campaign,
        nullableTrim(input.adCreative),
        nullableTrim(input.form),
        input.stage ?? 'new',
        input.aiAnalysis?.intent ?? null,
        input.aiAnalysis?.priority ?? null,
        input.aiAnalysis?.summary ?? null,
        input.aiAnalysis?.qualification ? JSON.stringify(input.aiAnalysis.qualification) : null,
        input.aiAnalysis?.analyzedAt ?? null,
        input.qualificationAnswers ? JSON.stringify(input.qualificationAnswers) : null,
        input.appointmentDate ?? null,
        input.conversionValue ?? null,
        now,
        now,
      ],
    );

    const event = await insertLeadEvent(client, {
      leadId: id,
      type: 'lead_received',
      source: 'manual',
      summary: `${input.name.trim()} was added to the REKREATIVE CRM`,
      details: { source, campaign },
      occurredAt: now,
    });

    if (input.stage === 'proposal_sent') {
      await insertLeadEvent(client, {
        leadId: id, type: 'proposal_sent', source: 'manual',
        summary: 'Propuesta enviada', occurredAt: now,
      });
    }
    const finalRow = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1', [id]);
    return { lead: rowToLead(finalRow.rows[0]), event };
  });
}

// Each transform receives the raw patch value and returns the value to bind.
// Kept as explicit per-field functions rather than a generic string/JSON
// branch — the fields don't all share one shape (required vs. nullable vs.
// JSONB vs. numeric), so a shared branch was actually harder to read.
const UPDATABLE_LEAD_FIELDS: Array<{ key: keyof UpdateLeadInput; column: string; toDb: (value: unknown) => unknown }> = [
  { key: 'name', column: 'name', toDb: (v) => (v as string).trim() },
  { key: 'email', column: 'email', toDb: (v) => nullableTrim(v as string | null) },
  { key: 'phone', column: 'phone', toDb: (v) => nullableTrim(v as string | null) },
  { key: 'whatsapp', column: 'whatsapp', toDb: (v) => nullableTrim(v as string | null) },
  { key: 'source', column: 'lead_source', toDb: (v) => (v as string).trim() || 'Manual' },
  { key: 'campaign', column: 'campaign', toDb: (v) => nullableTrim(v as string | null) },
  { key: 'adCreative', column: 'ad_creative', toDb: (v) => nullableTrim(v as string | null) },
  { key: 'form', column: 'form', toDb: (v) => nullableTrim(v as string | null) },
  { key: 'qualificationAnswers', column: 'qualification_answers', toDb: (v) => (v ? JSON.stringify(v) : null) },
  { key: 'appointmentDate', column: 'appointment_date', toDb: (v) => v ?? null },
  { key: 'conversionValue', column: 'conversion_value', toDb: (v) => v ?? null },
];

/** Business-field-only PATCH — see UpdateLeadInput's doc comment for why
 *  scope/clientId/stage are excluded. */
export async function updateLead(id: string, patch: UpdateLeadInput): Promise<ServerLead | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const { key, column, toDb } of UPDATABLE_LEAD_FIELDS) {
    if (!(key in patch)) continue;
    values.push(toDb(patch[key]));
    setClauses.push(`${column} = $${values.length}`);
  }

  if ('aiAnalysis' in patch) {
    const analysis = patch.aiAnalysis ?? null;
    values.push(analysis?.intent ?? null);
    setClauses.push(`ai_intent = $${values.length}`);
    values.push(analysis?.priority ?? null);
    setClauses.push(`ai_priority = $${values.length}`);
    values.push(analysis?.summary ?? null);
    setClauses.push(`ai_summary = $${values.length}`);
    values.push(analysis?.qualification ? JSON.stringify(analysis.qualification) : null);
    setClauses.push(`ai_qualification = $${values.length}`);
    values.push(analysis?.analyzedAt ?? null);
    setClauses.push(`ai_analyzed_at = $${values.length}`);
  }

  if (setClauses.length === 0) return getLeadById(id);

  values.push(id);
  const result = await query<LeadRow>(
    `UPDATE leads SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return result.rowCount === 0 ? null : rowToLead(result.rows[0]);
}

/**
 * Read+lock the current row → no-op if the stage is unchanged (never a
 * misleading duplicate stage_changed event) → else UPDATE stage → append
 * the stage_changed event. Runs on a caller-supplied client so it can be
 * composed into a larger transaction (see appendWhatsAppEvent, which needs
 * the whatsapp_sent event and its automatic new→contacted transition to
 * commit or roll back together) as well as as its own standalone
 * transaction (see setLeadStage below).
 */
async function setLeadStageOnClient(
  client: PoolClient,
  id: string,
  nextStage: LeadStage,
  source: LeadEventSource,
): Promise<{ lead: ServerLead; event: LeadEvent | null } | null> {
  const current = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [id]);
  if (current.rowCount === 0) return null;

  const existing = rowToLead(current.rows[0]);
  if (existing.stage === nextStage) {
    return { lead: existing, event: null };
  }

  assertStageTransitionAllowed(existing.stage, nextStage);

  // The generic stage selector must record the same commercial fact.
  // appendCommercialEvent already inserts it before calling this helper.
  if (nextStage === 'proposal_sent') {
    const prior = await client.query(
      "SELECT 1 FROM lead_events WHERE lead_id = $1 AND type = 'proposal_sent' LIMIT 1",
      [id],
    );
    if (prior.rowCount === 0) {
      await insertLeadEvent(client, {
        leadId: id, type: 'proposal_sent', source,
        summary: 'Propuesta enviada', occurredAt: new Date(),
      });
    }
  }

  await client.query('UPDATE leads SET stage = $2 WHERE id = $1', [id, nextStage]);

  const event = await insertLeadEvent(client, {
    leadId: id,
    type: 'stage_changed',
    source,
    summary: `Stage changed to ${stageLabel(nextStage)}`,
    details: { from: existing.stage, to: nextStage },
    occurredAt: new Date(),
  });

  const finalRow = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1', [id]);
  return { lead: rowToLead(finalRow.rows[0]), event };
}

/** Public, standalone-transaction entry point — mirrors lib/leads.ts's old
 *  setLeadStage exactly. See setLeadStageOnClient for the atomic core. */
export async function setLeadStage(
  id: string,
  nextStage: LeadStage,
  source: LeadEventSource = 'manual',
): Promise<{ lead: ServerLead; event: LeadEvent | null } | null> {
  return withTransaction((client) => setLeadStageOnClient(client, id, nextStage, source));
}

/** Public append surface — checks the lead exists first (LeadNotFoundError
 *  otherwise), so a bad id 404s cleanly instead of tripping the lead_events
 *  foreign key. No update/delete counterpart exists: the timeline is
 *  append-only by omission, not by trigger, in this pass. */
export async function appendLeadEvent(input: {
  leadId: string;
  type: LeadEventType;
  source: LeadEventSource;
  summary: string;
  details?: Record<string, unknown> | null;
  occurredAt?: string;
}): Promise<LeadEvent> {
  return withTransaction(async (client) => {
    const existing = await client.query('SELECT 1 FROM leads WHERE id = $1 FOR UPDATE', [input.leadId]);
    if (existing.rowCount === 0) throw new LeadNotFoundError(input.leadId);

    return insertLeadEvent(client, {
      leadId: input.leadId,
      type: input.type,
      source: input.source,
      summary: input.summary,
      details: input.details ?? null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    });
  });
}

// ── Ingestion primitives (Backend V1 foundation only) ────────────────────
// Not exposed through any HTTP route yet — POST /api/ingest/leads is a
// later pass. Kept here, tested here, so that route is a thin wrapper when
// it lands instead of a place new dedupe logic gets invented under time
// pressure.

export async function findByDeliveryId(deliveryId: string): Promise<ServerLead | null> {
  const result = await query<LeadRow>('SELECT * FROM leads WHERE ingest_delivery_id = $1', [deliveryId]);
  return result.rowCount === 0 ? null : rowToLead(result.rows[0]);
}

export async function findByExternalIdentity(ingestionSource: string, externalLeadId: string): Promise<ServerLead | null> {
  const result = await query<LeadRow>(
    'SELECT * FROM leads WHERE ingestion_source = $1 AND external_lead_id = $2',
    [ingestionSource, externalLeadId],
  );
  return result.rowCount === 0 ? null : rowToLead(result.rows[0]);
}

export type IngestLeadInput = Omit<CreateLeadInput, 'scope' | 'clientId'> & {
  scope?: LeadScope;
  clientId?: string | null;
  /** Idempotency key 1: the same Make execution retried must never duplicate. */
  deliveryId: string;
  /** e.g. 'meta'. Paired with externalLeadId as idempotency key 2. */
  ingestionSource: string;
  externalLeadId?: string | null;
  /** Meta Ads Real V1 — optional, ingestion-only structured attribution. */
  metaCampaignId?: string | null;
  metaAdsetId?: string | null;
  metaAdId?: string | null;
  metaFormId?: string | null;
  metaPageId?: string | null;
};

export type IngestLeadResult = {
  lead: ServerLead;
  /** null when this call deduped against an existing lead — no new event was appended. */
  event: LeadEvent | null;
  deduped: boolean;
};

/**
 * Atomic ingest with the approved double idempotency:
 *  - ingest_delivery_id UNIQUE (partial): a retried delivery of the same
 *    Make execution resolves to the existing row, no new event.
 *  - (ingestion_source, external_lead_id) UNIQUE (partial): the same
 *    upstream lead arriving through a *different* delivery also resolves
 *    to the existing row, no new event.
 * Only a genuinely new lead gets its lead_received event appended.
 */
export async function ingestLeadTransactional(input: IngestLeadInput): Promise<IngestLeadResult> {
  return withTransaction(async (client) => {
    let scope = input.scope;
    let clientId = input.clientId ?? null;
    let resolvedFromMeta = false;

    if (input.metaFormId) {
      const mappings = await client.query<{ owner_scope: LeadScope; client_id: string | null }>(
        `SELECT DISTINCT owner_scope, client_id
         FROM client_meta_accounts
         WHERE active = true
           AND valid_from <= CURRENT_DATE
           AND (valid_to IS NULL OR CURRENT_DATE < valid_to)
           AND meta_form_ids ? $1
           AND ($2::text IS NULL OR meta_page_id IS NULL OR meta_page_id = $2)
         LIMIT 2`,
        [input.metaFormId, input.metaPageId ?? null],
      );
      if ((mappings.rowCount ?? 0) > 1) {
        throw new MetaLeadRoutingError('More than one active owner matches this Meta form', 'META_FORM_AMBIGUOUS');
      }
      if (mappings.rowCount === 1) {
        const resolved = mappings.rows[0];
        if ((scope && scope !== resolved.owner_scope) || (input.clientId != null && input.clientId !== resolved.client_id)) {
          throw new MetaLeadRoutingError('Caller ownership conflicts with the registered Meta form', 'META_OWNER_MISMATCH');
        }
        scope = resolved.owner_scope;
        clientId = resolved.client_id;
        resolvedFromMeta = true;
      }
    }

    // Forms change frequently between campaigns and ad sets. The Page ID is
    // the stable provider identity for ownership, while Form ID remains
    // attribution. When an exact form is not registered, resolve the unique
    // owner of the destination page. DISTINCT deliberately permits one owner
    // to have several Meta ad-account mappings for the same page.
    if (!resolvedFromMeta && input.metaPageId) {
      const mappings = await client.query<{ owner_scope: LeadScope; client_id: string | null }>(
        `SELECT DISTINCT owner_scope, client_id
         FROM client_meta_accounts
         WHERE active = true
           AND valid_from <= CURRENT_DATE
           AND (valid_to IS NULL OR CURRENT_DATE < valid_to)
           AND meta_page_id = $1
         LIMIT 2`,
        [input.metaPageId],
      );
      if ((mappings.rowCount ?? 0) > 1) {
        throw new MetaLeadRoutingError('More than one active owner matches this Meta page', 'META_FORM_AMBIGUOUS');
      }
      if (mappings.rowCount === 1) {
        const resolved = mappings.rows[0];
        if ((input.scope && input.scope !== resolved.owner_scope) || (input.clientId != null && input.clientId !== resolved.client_id)) {
          throw new MetaLeadRoutingError('Caller ownership conflicts with the registered Meta page', 'META_OWNER_MISMATCH');
        }
        scope = resolved.owner_scope;
        clientId = resolved.client_id;
        resolvedFromMeta = true;
      }
    }

    // A payload that identifies its Meta page must never fall back to a
    // caller-supplied scope. Otherwise a cloned Make scenario retaining
    // `scope: internal` could silently route a client's lead to REKREATIVE.
    if (input.metaPageId && !resolvedFromMeta) {
      throw new MetaLeadRoutingError('Meta page is not mapped to an active owner', 'META_FORM_UNMAPPED');
    }

    // Backwards compatibility is restricted to legacy payloads that carry no
    // Page ID. New Meta scenarios must provide metaPageId and let REKREOS be
    // the sole owner resolver.
    if (!scope) {
      throw new MetaLeadRoutingError('Meta form is not mapped to an active owner', 'META_FORM_UNMAPPED');
    }
    await assertScopeInvariant(client, scope, clientId);

    const id = generateLeadId();
    const now = new Date();
    const source = input.source?.trim() || 'Manual';
    const campaign = nullableTrim(input.campaign);
    // Presence of the object at all — not any individual field being
    // populated — is what counts as "an AI analysis pass occurred". Make
    // never supplies analyzedAt (IngestLeadBodySchema has no such field);
    // this server-stamped `now` is the only source of truth for it.
    const hasAiAnalysis = input.aiAnalysis != null;

    let insertResult;
    try {
      insertResult = await client.query<LeadRow>(
        `INSERT INTO leads (
           id, scope, client_id, name, email, phone, whatsapp,
           lead_source, campaign, ad_creative, form, stage,
           ai_intent, ai_priority, ai_summary, ai_qualification, ai_analyzed_at,
           qualification_answers, appointment_date, conversion_value,
           ingestion_source, external_lead_id, ingest_delivery_id,
           meta_campaign_id, meta_adset_id, meta_ad_id, meta_form_id, meta_page_id,
           created_at, last_activity_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
         ON CONFLICT (ingest_delivery_id) WHERE ingest_delivery_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [
          id,
          scope,
          clientId,
          input.name.trim(),
          nullableTrim(input.email),
          nullableTrim(input.phone),
          nullableTrim(input.whatsapp),
          source,
          campaign,
          nullableTrim(input.adCreative),
          nullableTrim(input.form),
          input.stage ?? 'new',
          input.aiAnalysis?.intent ?? null,
          input.aiAnalysis?.priority ?? null,
          input.aiAnalysis?.summary ?? null,
          input.aiAnalysis?.qualification ? JSON.stringify(input.aiAnalysis.qualification) : null,
          hasAiAnalysis ? now : null,
          input.qualificationAnswers ? JSON.stringify(input.qualificationAnswers) : null,
          input.appointmentDate ?? null,
          input.conversionValue ?? null,
          input.ingestionSource,
          input.externalLeadId ?? null,
          input.deliveryId,
          nullableTrim(input.metaCampaignId),
          nullableTrim(input.metaAdsetId),
          nullableTrim(input.metaAdId),
          nullableTrim(input.metaFormId),
          nullableTrim(input.metaPageId),
          now,
          now,
        ],
      );
    } catch (error) {
      // Different deliveryId, same upstream lead — the external-identity
      // partial unique index rejected the insert.
      if (isUniqueViolation(error) && input.externalLeadId) {
        const existing = await findByExternalIdentity(input.ingestionSource, input.externalLeadId);
        if (existing) return { lead: existing, event: null, deduped: true };
      }
      throw error;
    }

    if (insertResult.rowCount === 0) {
      // Same deliveryId retried — ON CONFLICT DO NOTHING hit.
      const existing = await findByDeliveryId(input.deliveryId);
      if (existing) return { lead: existing, event: null, deduped: true };
      throw new Error(`Ingest insert reported no rows but no existing lead found for deliveryId ${input.deliveryId}`);
    }

    const event = await insertLeadEvent(client, {
      leadId: id,
      type: 'lead_received',
      source: 'make',
      summary: `${input.name.trim()} was received via automated ingestion`,
      details: {
        source,
        campaign,
        ingestionSource: input.ingestionSource,
        externalLeadId: input.externalLeadId ?? null,
        metaFormId: input.metaFormId ?? null,
        metaPageId: input.metaPageId ?? null,
      },
      occurredAt: now,
    });

    // Only on this fresh-insert path — a deduped replay (either idempotency
    // branch above) returns before reaching here, so a retried delivery can
    // never produce a second ai_analyzed event. Details stay minimal
    // (intent/priority only): the full aiAnalysis payload already lives on
    // the lead row itself, not duplicated into the event log.
    if (hasAiAnalysis) {
      await insertLeadEvent(client, {
        leadId: id,
        type: 'ai_analyzed',
        source: 'openai',
        summary: `${input.name.trim()} was analyzed by AI qualification`,
        details: { intent: input.aiAnalysis?.intent ?? null, priority: input.aiAnalysis?.priority ?? null },
        // +1ms, strictly after lead_received's `now` — both events land in
        // the same transaction, so occurred_at (and often created_at too)
        // would otherwise tie and fall back to listLeadEvents' id-order
        // tiebreaker, which doesn't reflect business sequence. Does not
        // affect ai_analyzed_at, which stays `now` on the lead row itself.
        occurredAt: new Date(now.getTime() + 1),
      });
    }

    const finalRow = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1', [id]);
    return { lead: rowToLead(finalRow.rows[0]), event, deduped: false };
  });
}

// ── WhatsApp event reporting (Make → REKREATIVE OS) ──────────────────────
// Outbound (Make performed a send) and inbound (Make relays a WhatsApp
// Business Cloud webhook it owns) both land through the one primitive
// below — see app/api/leads/whatsapp-events/route.ts. A future direct
// WhatsApp Cloud adapter can call appendWhatsAppEvent the same way without
// any change here.

type WhatsAppEventCommon = {
  type: 'whatsapp_sent' | 'whatsapp_delivered' | 'whatsapp_failed' | 'lead_replied';
  source: LeadEventSource;
  externalEventId: string;
  summary: string;
  details?: Record<string, unknown> | null;
  occurredAt?: string;
};

// Each branch fully spelled out (rather than a common type intersected
// with a union) so `'leadId' in input` narrows cleanly — TS's control-flow
// analysis doesn't reliably distribute an `in` check across an
// intersection-with-a-union shape.
export type AppendWhatsAppEventInput =
  | (WhatsAppEventCommon & {
      type: 'whatsapp_sent' | 'whatsapp_delivered' | 'whatsapp_failed';
      leadId: string;
      whatsappNumber?: undefined;
    })
  | (WhatsAppEventCommon & {
      type: 'lead_replied';
      leadId?: undefined;
      whatsappNumber: string;
      phoneNumberId: string;
      wabaId?: string;
      occurredAt: string;
    });

export type AppendWhatsAppEventResult =
  | { matched: true; lead: ServerLead; event: LeadEvent; deduped: boolean }
  | { matched: false };

export class UnmappedWhatsAppBusinessNumberError extends Error {
  constructor(public readonly phoneNumberId: string) {
    super('Unmapped or inactive WhatsApp business number');
    this.name = 'UnmappedWhatsAppBusinessNumberError';
  }
}

export class WhatsAppWabaMismatchError extends Error {
  constructor() {
    super('WhatsApp WABA does not match the registered business number');
    this.name = 'WhatsAppWabaMismatchError';
  }
}

export class AmbiguousWhatsAppLeadError extends Error {
  constructor() {
    super('More than one lead matches this WhatsApp number inside the resolved owner');
    this.name = 'AmbiguousWhatsAppLeadError';
  }
}

export class WhatsAppIdempotencyConflictError extends Error {
  constructor() {
    super('The WhatsApp message id is already associated with another lead');
    this.name = 'WhatsAppIdempotencyConflictError';
  }
}

/**
 * Atomic: resolve the target lead (by id for outbound events, or by the
 * destination Phone Number ID owner plus sender number for inbound ones),
 * then idempotently append the event. For
 * whatsapp_sent only, advance stage new→contacted through the exact same
 * setLeadStageOnClient core the UI's setLeadStage uses (never a bespoke
 * stage write, never backwards, never past an already-further-along
 * stage — the `existing.stage === 'new'` guard is what enforces that, and
 * is safe to re-check on every replay since a second call simply finds the
 * stage is no longer 'new').
 *
 * leadId not found → throws LeadNotFoundError (Make already has a real id
 * from ingestion, so an unknown one is a genuine integration error — same
 * convention as appendLeadEvent). An inbound number not found inside its
 * resolved owner returns
 * { matched: false }, a safe no-op: the phone/lead mapping gap is expected
 * (e.g. an inbound message from a number no ingested lead carries yet),
 * never grounds for fabricating a lead.
 */
export async function appendWhatsAppEvent(input: AppendWhatsAppEventInput): Promise<AppendWhatsAppEventResult> {
  // Resolved to plain nullable locals before the transaction closure below —
  // TS's 'in' narrowing on a union-typed parameter doesn't reliably survive
  // capture inside a nested async callback, so the branch is settled here
  // instead of re-narrowing `input` itself inside withTransaction.
  return withTransaction(async (client) => {
    let lead: ServerLead;
    let whatsappBusinessNumberId: string | null = null;

    if (input.type !== 'lead_replied') {
      const found = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [input.leadId]);
      if (found.rowCount === 0) throw new LeadNotFoundError(input.leadId);
      lead = rowToLead(found.rows[0]);
    } else {
      const occurredAt = new Date(input.occurredAt);
      const mapping = await resolveWhatsAppBusinessNumberOnClient(client, input.phoneNumberId, occurredAt);
      if (!mapping) throw new UnmappedWhatsAppBusinessNumberError(input.phoneNumberId);
      if (mapping.wabaId && input.wabaId && mapping.wabaId !== input.wabaId) {
        throw new WhatsAppWabaMismatchError();
      }
      const digits = normalizePhoneDigits(input.whatsappNumber);
      if (!digits) return { matched: false };
      const ownerClause =
        mapping.ownerScope === 'internal'
          ? "scope = 'internal' AND client_id IS NULL"
          : "scope = 'client' AND client_id = $2";
      const params = mapping.ownerScope === 'internal' ? [digits] : [digits, mapping.clientId];
      const found = await client.query<LeadRow>(
        `SELECT * FROM leads
         WHERE whatsapp_normalized = $1 AND ${ownerClause}
         LIMIT 2 FOR UPDATE`,
        params,
      );
      if (found.rowCount === 0) return { matched: false };
      if ((found.rowCount ?? 0) > 1) throw new AmbiguousWhatsAppLeadError();
      lead = rowToLead(found.rows[0]);
      whatsappBusinessNumberId = mapping.id;
    }

    const { event, deduped } = await insertLeadEventIdempotent(client, {
      leadId: lead.id,
      type: input.type,
      source: input.source,
      summary: input.summary,
      details: input.details ?? null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      externalEventId: input.externalEventId,
      whatsappBusinessNumberId,
    });

    if (deduped) {
      if (event.leadId !== lead.id) throw new WhatsAppIdempotencyConflictError();
      return { matched: true, lead, event, deduped: true };
    }

    // Approved V1 rule: whatsapp_sent advances new→contacted only. Never
    // lead_replied→qualified (a reply isn't necessarily commercial
    // qualification) and never whatsapp_delivered (a delivery receipt isn't
    // a business milestone).
    if (input.type === 'whatsapp_sent' && lead.stage === 'new') {
      await setLeadStageOnClient(client, lead.id, 'contacted', 'make');
    }

    const finalRow = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1', [lead.id]);
    return { matched: true, lead: rowToLead(finalRow.rows[0]), event, deduped };
  });
}

// ── Commercial event reporting (Make + manual → REKREATIVE OS) ───────────
// Shared primitive for the five commercial-lifecycle event types
// (qualified, appointment_booked, appointment_completed, converted,
// disqualified),
// used by both POST /api/leads/commercial-events (Make, source 'make',
// externalEventId required — durable idempotency) and
// POST /api/leads/[id]/commercial-events (manual UI, source 'manual',
// externalEventId omitted — never deduped). Neither caller can choose stage
// or source directly through their request body; this function is the only
// place that decides both, same discipline as appendWhatsAppEvent.

export type CommercialEventType = 'proposal_sent' | 'qualified' | 'appointment_booked' | 'appointment_completed' | 'converted' | 'disqualified';

// Every commercial event's target stage. Incompatible transitions out of a
// terminal stage are rejected before any event or field is written.
// appointment_booked
// and appointment_completed intentionally share the same target: a completed
// appointment implies a booked one even if the booked webhook was missed —
// there is deliberately no separate "appointment completed" stage (Results'
// funnel derives attendance from the appointment_completed EVENT, never from
// stage — see lib/results.ts's maxReachedStageRank).
const COMMERCIAL_EVENT_TARGET_STAGE: Record<CommercialEventType, LeadStage> = {
  proposal_sent: 'proposal_sent',
  qualified: 'qualified',
  appointment_booked: 'appointment',
  appointment_completed: 'appointment',
  converted: 'converted',
  disqualified: 'disqualified',
};

// Once a lead reaches either terminal stage, no commercial event, automated
// or manual, may move it again: 'converted' must never be downgraded to
// 'disqualified' by a later signal (e.g. a clawback), and 'disqualified'
// must never be silently "revived" by a stray appointment/conversion event.
// The incompatible event is rejected before insertion. 'no_response' is
// deliberately NOT terminal: it's a soft "hasn't engaged yet" state, so
// a later appointment/conversion event still advances it normally.
const COMMERCIAL_STAGE_RANK: Partial<Record<LeadStage, number>> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  appointment: 3,
  proposal_sent: 4,
  converted: 5,
  no_response: -1,
};

function shouldApplyCommercialStage(current: LeadStage, target: LeadStage): boolean {
  if (current === target) return false;
  if (target === 'disqualified') return true;
  return (COMMERCIAL_STAGE_RANK[target] ?? -1) > (COMMERCIAL_STAGE_RANK[current] ?? -1);
}

export type AppendCommercialEventInput = {
  leadId: string;
  type: CommercialEventType;
  source: LeadEventSource;
  summary: string;
  details?: Record<string, unknown> | null;
  occurredAt?: string;
  /** Idempotency key for Make-reported events — the same (type,
   *  external_event_id) mechanism WhatsApp lifecycle V1 uses. Omitted for
   *  manual UI actions. Proposal retries are also deduped per lead. */
  externalEventId?: string;
  /** Required (by the caller's own Zod schema) for appointment_booked only. */
  appointmentDate?: string;
  /** Optional for converted only; omitted (not null) means "leave the
   *  lead's existing conversionValue untouched" — never clears it. */
  conversionValue?: number;
  serviceId?: string;
  paymentPlan?: ConversionPaymentPlan;
  initialPayment?: number;
};

export type AppendCommercialEventResult = {
  lead: ServerLead;
  event: LeadEvent;
  deduped: boolean;
};

/**
 * Atomic: lock the lead → idempotently (Make) or plainly (manual) insert the
 * event → if that resolved to an already-existing event (a retried Make
 * delivery), return immediately with NO field/stage mutation → otherwise
 * apply the event's field update (appointmentDate/conversionValue) and, if
 * the lead isn't already in a terminal stage, advance it to the event's
 * target stage through the exact same setLeadStageOnClient core every other
 * stage write in this repo uses. Reuses insertLeadEventIdempotent/
 * insertLeadEvent and setLeadStageOnClient rather than re-implementing
 * either.
 *
 * leadId not found → LeadNotFoundError, same convention as
 * appendLeadEvent/appendWhatsAppEvent (both callers already have a real id:
 * Make from ingestion, the manual UI from the lead row it's rendering).
 */
export async function appendCommercialEvent(input: AppendCommercialEventInput): Promise<AppendCommercialEventResult> {
  return withTransaction(async (client) => {
    const found = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [input.leadId]);
    if (found.rowCount === 0) throw new LeadNotFoundError(input.leadId);
    const existing = rowToLead(found.rows[0]);

    // Resolve a completed delivery before validating today's stage. A valid
    // retry must remain idempotent even if the lead has since advanced to a
    // terminal stage. The lead lock serializes same-lead deliveries; the
    // unique index and post-insert ownership check below cover cross-lead
    // races, whose rows are locked independently.
    if (input.externalEventId) {
      const prior = await client.query<LeadEventRow>(
        'SELECT * FROM lead_events WHERE type = $1 AND external_event_id = $2',
        [input.type, input.externalEventId],
      );
      if (prior.rowCount && prior.rowCount > 0) {
        const event = rowToLeadEvent(prior.rows[0]);
        if (event.leadId !== input.leadId) throw new CommercialEventIdempotencyConflictError();
        return { lead: existing, event, deduped: true };
      }
    }

    // Serialize manual double clicks using the same lead row lock. Make
    // retains its explicit occurrence identity (type + externalEventId).
    if (input.type === 'proposal_sent' && !input.externalEventId) {
      const prior = await client.query<LeadEventRow>(
        "SELECT * FROM lead_events WHERE lead_id = $1 AND type = 'proposal_sent' ORDER BY occurred_at, id LIMIT 1",
        [input.leadId],
      );
      if (prior.rows[0]) return { lead: existing, event: rowToLeadEvent(prior.rows[0]), deduped: true };
    }

    const targetStage = COMMERCIAL_EVENT_TARGET_STAGE[input.type];
    assertStageTransitionAllowed(existing.stage, targetStage);

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    let eventDetails = input.details ?? null;
    let serviceSnapshot: {
      id: string;
      name: string;
      price: number;
      billingType: 'one_off' | 'monthly';
      secondPaymentTrigger: string | null;
    } | null = null;

    if (input.type === 'converted' && input.serviceId) {
      if (input.conversionValue === undefined || input.paymentPlan === undefined || input.initialPayment === undefined) {
        throw new CommercialConversionValidationError('complete commercial terms are required');
      }
      if (input.initialPayment > input.conversionValue) {
        throw new CommercialConversionValidationError('initial payment cannot exceed agreed value');
      }
      if (existing.conversionSnapshot && input.initialPayment !== existing.conversionSnapshot.initialPayment) {
        throw new CommercialConversionValidationError('the initial payment is immutable; record a separate payment instead');
      }
      if (existing.scope !== 'internal') {
        throw new CommercialConversionValidationError('internal services can only be assigned to internal leads');
      }
      const serviceResult = await client.query<{
        id: string;
        name: string;
        price: string;
        billing_type: string;
        allow_two_payments: boolean;
        second_payment_trigger: string | null;
      }>(
        'SELECT id, name, price, billing_type, allow_two_payments, second_payment_trigger FROM internal_business_services WHERE id = $1 AND active = true',
        [input.serviceId],
      );
      if (serviceResult.rowCount === 0) throw new CommercialConversionValidationError('service not found or inactive');
      const service = serviceResult.rows[0];
      if (input.paymentPlan === 'two_payments' && !service.allow_two_payments) {
        throw new CommercialConversionValidationError('service does not allow two payments');
      }
      if (input.paymentPlan === 'monthly' && service.billing_type !== 'monthly') {
        throw new CommercialConversionValidationError('monthly plan requires a monthly service');
      }
      if (!['monthly', 'custom'].includes(input.paymentPlan) && service.billing_type === 'monthly') {
        throw new CommercialConversionValidationError('monthly service requires a monthly plan');
      }
      serviceSnapshot = {
        id: service.id,
        name: service.name,
        price: Number(service.price),
        billingType: service.billing_type as 'one_off' | 'monthly',
        secondPaymentTrigger: service.second_payment_trigger,
      };
      eventDetails = {
        ...(input.details ?? {}),
        serviceId: service.id,
        serviceName: service.name,
        standardPrice: Number(service.price),
        billingType: service.billing_type,
        paymentPlan: input.paymentPlan,
        agreedValue: input.conversionValue,
        initialPayment: input.initialPayment,
        outstandingAmount: Math.max(0, (input.conversionValue ?? 0) - (input.initialPayment ?? 0)),
        secondPaymentTrigger: service.second_payment_trigger,
      };
    }
    let event: LeadEvent;
    let deduped = false;

    if (input.externalEventId) {
      const result = await insertLeadEventIdempotent(client, {
        leadId: input.leadId,
        type: input.type,
        source: input.source,
        summary: input.summary,
        details: eventDetails,
        occurredAt,
        externalEventId: input.externalEventId,
      });
      event = result.event;
      deduped = result.deduped;
    } else {
      event = await insertLeadEvent(client, {
        leadId: input.leadId,
        type: input.type,
        source: input.source,
        summary: input.summary,
        details: eventDetails,
        occurredAt,
      });
    }

    // A retried Make delivery resolved to an already-existing event — never
    // re-apply the field/stage side effects a second time.
    if (deduped) {
      if (event.leadId !== input.leadId) throw new CommercialEventIdempotencyConflictError();
      return { lead: existing, event, deduped: true };
    }

    if (input.type === 'appointment_booked' && input.appointmentDate) {
      await client.query('UPDATE leads SET appointment_date = $2 WHERE id = $1', [input.leadId, input.appointmentDate]);
    }
    if (input.type === 'converted' && input.conversionValue !== undefined) {
      await client.query('UPDATE leads SET conversion_value = $2 WHERE id = $1', [input.leadId, input.conversionValue]);
    }
    if (input.type === 'converted' && serviceSnapshot) {
      await client.query(
        `UPDATE leads SET
           conversion_value = $2,
           conversion_service_id = $3,
           conversion_service_name = $4,
           conversion_service_billing_type = $5,
           conversion_service_standard_price = $6,
           conversion_payment_plan = $7,
           conversion_initial_payment = $8,
           conversion_second_payment_trigger = $9,
           conversion_recorded_at = $10
         WHERE id = $1`,
        [
          input.leadId,
          input.conversionValue,
          serviceSnapshot.id,
          serviceSnapshot.name,
          serviceSnapshot.billingType,
          serviceSnapshot.price,
          input.paymentPlan,
          input.initialPayment,
          serviceSnapshot.secondPaymentTrigger,
          occurredAt,
        ],
      );

      // The agreed value is never a receipt. Only a first conversion creates
      // the initial ledger row; editing the agreement later must not charge
      // the same initial amount a second time.
      if (existing.conversionSnapshot === null && (input.initialPayment ?? 0) > 0) {
        await insertLeadPaymentOnClient(client, {
          leadId: input.leadId,
          amount: input.initialPayment as number,
          occurredAt,
          source: 'conversion_initial',
          notes: 'Cobro inicial registrado al convertir el lead',
        });
      }
    }

    if (shouldApplyCommercialStage(existing.stage, targetStage)) {
      await setLeadStageOnClient(client, input.leadId, targetStage, input.source);
    }

    const finalRow = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1', [input.leadId]);
    return { lead: rowToLead(finalRow.rows[0]), event, deduped: false };
  });
}

import type { PoolClient } from 'pg';
import {
  LEAD_STAGE_OPTIONS,
  type Lead as LeadBase,
  type LeadAiAnalysis,
  type LeadEvent,
  type LeadEventSource,
  type LeadEventType,
  type LeadIntent,
  type LeadPriority,
  type LeadScope,
  type LeadStage,
} from '@/lib/leads';
import { query, withTransaction } from './db';
import { normalizePhoneDigits } from '../phone';

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
};

type LeadRow = {
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
  ingestion_source: string | null;
  external_lead_id: string | null;
  ingest_delivery_id: string | null;
  created_at: Date;
  last_activity_at: Date;
};

type LeadEventRow = {
  id: string;
  lead_id: string;
  type: string;
  source: string;
  occurred_at: Date;
  summary: string;
  details: Record<string, unknown> | null;
  external_event_id?: string | null;
};

function rowToLead(row: LeadRow): ServerLead {
  const hasAiAnalysis =
    row.ai_intent !== null || row.ai_priority !== null || row.ai_summary !== null || row.ai_qualification !== null || row.ai_analyzed_at !== null;

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
    ingestionSource: row.ingestion_source,
    externalLeadId: row.external_lead_id,
    deliveryId: row.ingest_delivery_id,
  };
}

function rowToLeadEvent(row: LeadEventRow): LeadEvent {
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
  },
): Promise<{ event: LeadEvent; deduped: boolean }> {
  const id = generateEventId();
  const inserted = await client.query<LeadEventRow>(
    `INSERT INTO lead_events (id, lead_id, type, source, occurred_at, summary, details, external_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<LeadRow>(`SELECT * FROM leads ${where} ORDER BY last_activity_at DESC`, params);
  return result.rows.map(rowToLead);
}

export async function getLeadById(id: string): Promise<ServerLead | null> {
  const result = await query<LeadRow>('SELECT * FROM leads WHERE id = $1', [id]);
  return result.rowCount === 0 ? null : rowToLead(result.rows[0]);
}

export async function listLeadEvents(leadId: string): Promise<LeadEvent[]> {
  const result = await query<LeadEventRow>(
    'SELECT * FROM lead_events WHERE lead_id = $1 ORDER BY occurred_at ASC, created_at ASC, id ASC',
    [leadId],
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

export type IngestLeadInput = CreateLeadInput & {
  /** Idempotency key 1: the same Make execution retried must never duplicate. */
  deliveryId: string;
  /** e.g. 'meta'. Paired with externalLeadId as idempotency key 2. */
  ingestionSource: string;
  externalLeadId?: string | null;
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
  // See createLead's identical comment: never pre-null clientId for scope
  // 'internal' — assertScopeInvariant must see the real value to reject it.
  const clientId = input.clientId ?? null;

  return withTransaction(async (client) => {
    await assertScopeInvariant(client, input.scope, clientId);

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
           created_at, last_activity_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         ON CONFLICT (ingest_delivery_id) WHERE ingest_delivery_id IS NOT NULL DO NOTHING
         RETURNING *`,
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
          hasAiAnalysis ? now : null,
          input.qualificationAnswers ? JSON.stringify(input.qualificationAnswers) : null,
          input.appointmentDate ?? null,
          input.conversionValue ?? null,
          input.ingestionSource,
          input.externalLeadId ?? null,
          input.deliveryId,
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
      details: { source, campaign, ingestionSource: input.ingestionSource, externalLeadId: input.externalLeadId ?? null },
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

const WHATSAPP_NUMBER_LOOKUP_SQL = `regexp_replace(whatsapp, '\\D', '', 'g') = $1`;

/** Resolves a lead by WhatsApp number, comparing digits only (see
 *  lib/phone.ts's normalizePhoneDigits) so formatting differences between
 *  what a lead's whatsapp field holds and what the provider sends don't
 *  cause a false miss. Null for an unparseable number or no match — never
 *  throws, since "no lead has this number yet" is an expected outcome, not
 *  an error. */
export async function findByWhatsapp(whatsappNumber: string): Promise<ServerLead | null> {
  const digits = normalizePhoneDigits(whatsappNumber);
  if (!digits) return null;
  const result = await query<LeadRow>(`SELECT * FROM leads WHERE ${WHATSAPP_NUMBER_LOOKUP_SQL} LIMIT 1`, [digits]);
  return result.rowCount === 0 ? null : rowToLead(result.rows[0]);
}

type WhatsAppEventCommon = {
  type: 'whatsapp_sent' | 'whatsapp_delivered' | 'lead_replied';
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
  | (WhatsAppEventCommon & { leadId: string; whatsappNumber?: undefined })
  | (WhatsAppEventCommon & { leadId?: undefined; whatsappNumber: string });

export type AppendWhatsAppEventResult =
  | { matched: true; lead: ServerLead; event: LeadEvent; deduped: boolean }
  | { matched: false };

/**
 * Atomic: resolve the target lead (by id for outbound events, by WhatsApp
 * number for inbound ones) → idempotently append the event → for
 * whatsapp_sent only, advance stage new→contacted through the exact same
 * setLeadStageOnClient core the UI's setLeadStage uses (never a bespoke
 * stage write, never backwards, never past an already-further-along
 * stage — the `existing.stage === 'new'` guard is what enforces that, and
 * is safe to re-check on every replay since a second call simply finds the
 * stage is no longer 'new').
 *
 * leadId not found → throws LeadNotFoundError (Make already has a real id
 * from ingestion, so an unknown one is a genuine integration error — same
 * convention as appendLeadEvent). whatsappNumber not found → returns
 * { matched: false }, a safe no-op: the phone/lead mapping gap is expected
 * (e.g. an inbound message from a number no ingested lead carries yet),
 * never grounds for fabricating a lead.
 */
export async function appendWhatsAppEvent(input: AppendWhatsAppEventInput): Promise<AppendWhatsAppEventResult> {
  // Resolved to plain nullable locals before the transaction closure below —
  // TS's 'in' narrowing on a union-typed parameter doesn't reliably survive
  // capture inside a nested async callback, so the branch is settled here
  // instead of re-narrowing `input` itself inside withTransaction.
  const leadId = 'leadId' in input ? input.leadId : null;
  const whatsappNumber = 'whatsappNumber' in input ? input.whatsappNumber : null;

  return withTransaction(async (client) => {
    let lead: ServerLead;

    if (leadId) {
      const found = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1 FOR UPDATE', [leadId]);
      if (found.rowCount === 0) throw new LeadNotFoundError(leadId);
      lead = rowToLead(found.rows[0]);
    } else if (whatsappNumber) {
      const digits = normalizePhoneDigits(whatsappNumber);
      if (!digits) return { matched: false };
      const found = await client.query<LeadRow>(
        `SELECT * FROM leads WHERE ${WHATSAPP_NUMBER_LOOKUP_SQL} FOR UPDATE LIMIT 1`,
        [digits],
      );
      if (found.rowCount === 0) return { matched: false };
      lead = rowToLead(found.rows[0]);
    } else {
      // Unreachable given AppendWhatsAppEventInput's type — satisfies
      // control flow analysis without a non-null assertion.
      return { matched: false };
    }

    const { event, deduped } = await insertLeadEventIdempotent(client, {
      leadId: lead.id,
      type: input.type,
      source: input.source,
      summary: input.summary,
      details: input.details ?? null,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      externalEventId: input.externalEventId,
    });

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
// Shared primitive for the four commercial-lifecycle event types
// (appointment_booked, appointment_completed, converted, disqualified),
// used by both POST /api/leads/commercial-events (Make, source 'make',
// externalEventId required — durable idempotency) and
// POST /api/leads/[id]/commercial-events (manual UI, source 'manual',
// externalEventId omitted — never deduped). Neither caller can choose stage
// or source directly through their request body; this function is the only
// place that decides both, same discipline as appendWhatsAppEvent.

export type CommercialEventType = 'appointment_booked' | 'appointment_completed' | 'converted' | 'disqualified';

// Every commercial event's target stage, applied only if the lead isn't
// already in a terminal stage (see TERMINAL_STAGES below). appointment_booked
// and appointment_completed intentionally share the same target: a completed
// appointment implies a booked one even if the booked webhook was missed —
// there is deliberately no separate "appointment completed" stage (Results'
// funnel derives attendance from the appointment_completed EVENT, never from
// stage — see lib/results.ts's maxReachedStageRank).
const COMMERCIAL_EVENT_TARGET_STAGE: Record<CommercialEventType, LeadStage> = {
  appointment_booked: 'appointment',
  appointment_completed: 'appointment',
  converted: 'converted',
  disqualified: 'disqualified',
};

// Once a lead reaches either terminal stage, no commercial event — automated
// or manual — may move it again: 'converted' must never be downgraded to
// 'disqualified' by a later signal (e.g. a clawback), and 'disqualified'
// must never be silently "revived" by a stray appointment/conversion event.
// The event itself is still recorded either way (see appendCommercialEvent
// below) — only the stage write is skipped. 'no_response' is deliberately
// NOT in this set: it's a soft "hasn't engaged yet" state, not terminal, so
// a later appointment/conversion event still advances it normally.
const TERMINAL_STAGES: ReadonlySet<LeadStage> = new Set(['converted', 'disqualified']);

export type AppendCommercialEventInput = {
  leadId: string;
  type: CommercialEventType;
  source: LeadEventSource;
  summary: string;
  details?: Record<string, unknown> | null;
  occurredAt?: string;
  /** Idempotency key for Make-reported events — the same (type,
   *  external_event_id) mechanism WhatsApp lifecycle V1 uses. Omitted for
   *  manual UI actions, which are never deduped (an operator clicking a
   *  quick action twice records two events, same as "Añadir nota"). */
  externalEventId?: string;
  /** Required (by the caller's own Zod schema) for appointment_booked only. */
  appointmentDate?: string;
  /** Optional for converted only; omitted (not null) means "leave the
   *  lead's existing conversionValue untouched" — never clears it. */
  conversionValue?: number;
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

    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    let event: LeadEvent;
    let deduped = false;

    if (input.externalEventId) {
      const result = await insertLeadEventIdempotent(client, {
        leadId: input.leadId,
        type: input.type,
        source: input.source,
        summary: input.summary,
        details: input.details ?? null,
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
        details: input.details ?? null,
        occurredAt,
      });
    }

    // A retried Make delivery resolved to an already-existing event — never
    // re-apply the field/stage side effects a second time.
    if (deduped) {
      return { lead: existing, event, deduped: true };
    }

    if (input.type === 'appointment_booked' && input.appointmentDate) {
      await client.query('UPDATE leads SET appointment_date = $2 WHERE id = $1', [input.leadId, input.appointmentDate]);
    }
    if (input.type === 'converted' && input.conversionValue !== undefined) {
      await client.query('UPDATE leads SET conversion_value = $2 WHERE id = $1', [input.leadId, input.conversionValue]);
    }

    if (!TERMINAL_STAGES.has(existing.stage)) {
      await setLeadStageOnClient(client, input.leadId, COMMERCIAL_EVENT_TARGET_STAGE[input.type], input.source);
    }

    const finalRow = await client.query<LeadRow>('SELECT * FROM leads WHERE id = $1', [input.leadId]);
    return { lead: rowToLead(finalRow.rows[0]), event, deduped: false };
  });
}

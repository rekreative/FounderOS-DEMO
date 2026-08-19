import { getClients } from '@/lib/clients';
import type { Lead, LeadEvent, LeadStage } from '@/lib/leads';
import type { MetaCampaign } from '@/lib/meta-ads';

// Results V1 — "What business outcome is REKREATIVE generating for this
// client?" Everything here is either (a) the ONE new stored entity,
// RevenueRecord, or (b) a pure function deriving funnel/KPI numbers from
// RevenueRecord + the existing lib/leads.ts + lib/meta-ads.ts data. No KPI is
// ever persisted — same discipline as getCampaignCPL/getAutomationHealth/
// getIntegrationConfigurationStatus.

// ===== Revenue record model =====

export const REVENUE_SOURCE_OPTIONS = [
  { id: 'manual', label: 'Manual' },
  { id: 'stripe', label: 'Stripe' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'crm', label: 'CRM' },
] as const;
export type RevenueRecordSource = (typeof REVENUE_SOURCE_OPTIONS)[number]['id'];

/**
 * 'demo' = seeded placeholder data, 'manual' = entered by hand in this UI.
 * 'live' is deliberately absent from V1's own type — Results has no
 * Stripe/PayPal/CRM ingestion wired yet (lib/integration-connections.ts lists
 * those platforms, but "no financial records stored there" per its own
 * comments). Never set anything but demo/manual until a real sync exists —
 * same honesty rule as MetaCampaignDataSource/AutomationDataSource.
 */
export type RevenueRecordDataSource = 'demo' | 'manual';

export type RevenueRecord = {
  id: string;
  clientId: string;
  /**
   * Attributed revenue, by definition — revenue the user is attesting is
   * linked to REKREATIVE's acquisition activity, never the client's total
   * business revenue. There is deliberately no separate "attribution" field:
   * a per-record toggle would let two records in the same period mean
   * different things and quietly poison ROAS. Enforce the meaning only
   * through UI copy ("INGRESOS ATRIBUIDOS").
   */
  amount: number;
  /** ISO date of the sale/payment itself, not the entry date. */
  occurredAt: string;
  /** Only 'manual' is producible by this module in V1 (see createRevenueRecord). */
  source: RevenueRecordSource;
  /** Dedup key for a future automated sync. Always null for manual entries. */
  externalRef: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  dataSource: RevenueRecordDataSource;
};

export type CreateRevenueRecordInput = {
  clientId: string;
  amount: number;
  occurredAt: string;
  notes?: string | null;
  dataSource?: RevenueRecordDataSource;
};

/** clientId/amount/occurredAt/notes only — source/externalRef/dataSource stay
 * system-controlled, same single-writer discipline as
 * lib/integration-connections.ts's UpdateIntegrationConnectionInput excluding
 * verification fields. */
export type UpdateRevenueRecordInput = Partial<Pick<RevenueRecord, 'clientId' | 'amount' | 'occurredAt' | 'notes'>>;

const STORAGE_KEY = 'rek_revenue_records_v1';

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

// ===== Seed / demo data =====
// Intentionally obvious REKREATIVE-style demo revenue, spread across the
// seeded clients (lib/clients.ts) to validate: multiple records for one
// client (client-acme, across two different months — exercises period
// filtering), a client with revenue but a thinner campaign spend
// (client-lumen), and a client with ZERO revenue records at all
// (client-northwind — which also has zero real conversions in the seeded
// Leads data, so it doubles as the zero-conversion + zero-revenue edge case).
function seedDemoRevenueRecords(): RevenueRecord[] {
  const now = new Date();
  const daysAgo = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString();
  };
  const createdAt = daysAgo(45);

  return [
    {
      id: 'revenue-demo-1',
      clientId: 'client-acme',
      amount: 2600,
      occurredAt: daysAgo(5),
      source: 'manual',
      externalRef: null,
      notes: 'Pago inicial — paquete Full-funnel Meta Ads',
      createdAt: daysAgo(5),
      updatedAt: daysAgo(5),
      dataSource: 'demo',
    },
    {
      id: 'revenue-demo-2',
      clientId: 'client-acme',
      amount: 1400,
      occurredAt: daysAgo(35),
      source: 'manual',
      externalRef: null,
      notes: 'Upsell — servicio adicional',
      createdAt: daysAgo(35),
      updatedAt: daysAgo(35),
      dataSource: 'demo',
    },
    {
      id: 'revenue-demo-3',
      clientId: 'client-lumen',
      amount: 1350,
      occurredAt: daysAgo(10),
      source: 'manual',
      externalRef: null,
      notes: 'Cierre de consultoría inicial',
      createdAt: createdAt,
      updatedAt: daysAgo(10),
      dataSource: 'demo',
    },
    // client-northwind intentionally has NO revenue records — zero-revenue
    // client, paired with zero real conversions in its seeded Leads data.
  ];
}

export function initializeResultsStoreIfNeeded(): RevenueRecord[] {
  if (typeof window === 'undefined') {
    return seedDemoRevenueRecords();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDemoRevenueRecords();
    writeStorage(STORAGE_KEY, seeded);
    return seeded;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RevenueRecord[]) : seedDemoRevenueRecords();
  } catch (error) {
    console.error('Failed to parse revenue records from localStorage; leaving existing store intact.', error);
    return seedDemoRevenueRecords();
  }
}

// ===== CRUD =====

export function getRevenueRecords(clientId?: string): RevenueRecord[] {
  const records = readStorage<RevenueRecord>(STORAGE_KEY);
  const result = !clientId ? records : records.filter((record) => record.clientId === clientId);
  return result.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

export function getRevenueRecordById(id: string): RevenueRecord | null {
  return readStorage<RevenueRecord>(STORAGE_KEY).find((record) => record.id === id) ?? null;
}

/** Always writes source: 'manual', externalRef: null — this module has no
 * path to producing a 'stripe'/'paypal'/'crm' record in V1. */
export function createRevenueRecord(input: CreateRevenueRecordInput): RevenueRecord {
  const clientExists = getClients().some((client) => client.id === input.clientId);
  if (!clientExists) {
    throw new Error('Cannot create revenue record for a missing client id');
  }

  const now = isoNow();
  const created: RevenueRecord = {
    id: `revenue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientId: input.clientId,
    amount: input.amount,
    occurredAt: input.occurredAt,
    source: 'manual',
    externalRef: null,
    notes: input.notes?.trim() || null,
    createdAt: now,
    updatedAt: now,
    dataSource: input.dataSource ?? 'manual',
  };

  const records = readStorage<RevenueRecord>(STORAGE_KEY);
  writeStorage(STORAGE_KEY, [created, ...records]);
  return created;
}

export function updateRevenueRecord(id: string, patch: UpdateRevenueRecordInput): RevenueRecord | null {
  const records = readStorage<RevenueRecord>(STORAGE_KEY);
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) return null;

  if (patch.clientId) {
    const clientExists = getClients().some((client) => client.id === patch.clientId);
    if (!clientExists) {
      throw new Error('Cannot move revenue record to a missing client id');
    }
  }

  const updated: RevenueRecord = { ...records[index], ...patch, updatedAt: isoNow() };
  records[index] = updated;
  writeStorage(STORAGE_KEY, records);
  return updated;
}

export function getClientNameForRevenueRecord(clientId: string): string {
  return getClients().find((client) => client.id === clientId)?.name ?? 'Cliente desconocido';
}

export function getRevenueSourceLabel(source: RevenueRecordSource): string {
  return REVENUE_SOURCE_OPTIONS.find((option) => option.id === source)?.label ?? source;
}

// ===== Dedup preparation (future-facing — externalRef is always null in V1) =====

/**
 * Whether `source`+`externalRef` collides with an existing record. Always
 * false when externalRef is null, so manual entries never collide with each
 * other or with anything else. Uniqueness is deliberately source+externalRef
 * together, not externalRef alone — a bare Stripe charge id and a bare
 * PayPal transaction id could otherwise collide as plain strings. A future
 * sync job calls this before inserting an automated record; no reconciliation
 * UI exists yet, so a manual entry later re-imported via Stripe/PayPal can
 * still double-count today — a known, documented V1 limitation.
 */
export function isDuplicateRevenueRecord(
  records: Pick<RevenueRecord, 'source' | 'externalRef'>[],
  source: RevenueRecordSource,
  externalRef: string | null,
): boolean {
  if (externalRef == null) return false;
  return records.some((record) => record.source === source && record.externalRef === externalRef);
}

// ===== Period model =====

export const PERIOD_PRESET_OPTIONS = [
  { id: 'all', label: 'Todo' },
  { id: 'this_month', label: 'Este mes' },
  { id: 'last_month', label: 'Mes anterior' },
  { id: 'last_30_days', label: 'Últimos 30 días' },
  { id: 'custom', label: 'Personalizado' },
] as const;
export type PeriodPreset = (typeof PERIOD_PRESET_OPTIONS)[number]['id'];

/** Inclusive [start, end] date-only bounds (YYYY-MM-DD). Both null = unbounded ('all'). */
export type ResultsPeriod = { start: string | null; end: string | null };

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Resolves a preset (or a custom range) into concrete date bounds, relative to `now`. */
export function resolvePeriod(
  preset: PeriodPreset,
  custom?: { start: string; end: string },
  now: Date = new Date(),
): ResultsPeriod {
  if (preset === 'all') return { start: null, end: null };
  if (preset === 'custom') return { start: custom?.start ?? null, end: custom?.end ?? null };

  if (preset === 'this_month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return { start: toDateOnly(start), end: toDateOnly(end) };
  }

  if (preset === 'last_month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { start: toDateOnly(start), end: toDateOnly(end) };
  }

  // last_30_days — inclusive of today, 30 days wide.
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { start: toDateOnly(start), end: toDateOnly(end) };
}

/** Inclusive on both ends, compared at day resolution (ignores time-of-day). */
export function isWithinPeriod(isoDateTime: string, period: ResultsPeriod): boolean {
  const day = isoDateTime.slice(0, 10);
  if (period.start && day < period.start) return false;
  if (period.end && day > period.end) return false;
  return true;
}

export function filterLeadsByPeriod(leads: Lead[], period: ResultsPeriod): Lead[] {
  return leads.filter((lead) => isWithinPeriod(lead.createdAt, period));
}

export function filterRevenueRecordsByPeriod(records: RevenueRecord[], period: ResultsPeriod): RevenueRecord[] {
  return records.filter((record) => isWithinPeriod(record.occurredAt, period));
}

// ===== Period preference persistence =====
// A UI convenience only (which preset/range the operator was last looking
// at) — not part of the Results data model. Persisted the same way every
// other REKREATIVE preference is (localStorage), shared between /results and
// /clients/[clientId]/results so switching between the two views keeps the
// same period in view, and survives a refresh (F5).

const PERIOD_PREFERENCE_KEY = 'rek_results_period_v1';

export type PeriodPreference = { preset: PeriodPreset; start: string | null; end: string | null };

const DEFAULT_PERIOD_PREFERENCE: PeriodPreference = { preset: 'all', start: null, end: null };

export function getStoredPeriodPreference(): PeriodPreference {
  if (typeof window === 'undefined') return DEFAULT_PERIOD_PREFERENCE;
  try {
    const raw = window.localStorage.getItem(PERIOD_PREFERENCE_KEY);
    if (!raw) return DEFAULT_PERIOD_PREFERENCE;
    const parsed = JSON.parse(raw);
    const preset: PeriodPreset = PERIOD_PRESET_OPTIONS.some((option) => option.id === parsed?.preset)
      ? parsed.preset
      : 'all';
    return { preset, start: parsed?.start ?? null, end: parsed?.end ?? null };
  } catch (error) {
    console.error('Failed to parse the stored results period preference', error);
    return DEFAULT_PERIOD_PREFERENCE;
  }
}

export function setStoredPeriodPreference(preference: PeriodPreference): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PERIOD_PREFERENCE_KEY, JSON.stringify(preference));
  } catch (error) {
    console.error('Failed to persist the results period preference', error);
  }
}

// ===== Trend grouping (time-bucketed charts) =====
// Both charts below are historically honest: Lead.createdAt and
// RevenueRecord.occurredAt are real per-record dates (unlike MetaCampaign
// .spend/.leads, which are lifetime-cumulative with no time series — see
// "Ad spend availability" below). Never used to infer ad spend.

export type TrendGranularity = 'day' | 'week' | 'month';

/**
 * Picks a bucket size for a trend chart from the selected period — short,
 * bounded periods group by day so the chart stays granular; a long or
 * unbounded ('all') period groups by week/month so it stays readable instead
 * of rendering hundreds of single-day bars.
 */
export function resolveTrendGranularity(preset: PeriodPreset, period: ResultsPeriod): TrendGranularity {
  if (preset === 'this_month' || preset === 'last_month' || preset === 'last_30_days') return 'day';
  if (preset === 'custom' && period.start && period.end) {
    const days = (Date.parse(`${period.end}T00:00:00.000Z`) - Date.parse(`${period.start}T00:00:00.000Z`)) / 86_400_000;
    if (days <= 62) return 'day';
    if (days <= 365) return 'week';
    return 'month';
  }
  // 'all' (unbounded) or an incomplete custom range.
  return 'month';
}

function bucketKey(isoDateTime: string, granularity: TrendGranularity): string {
  const day = isoDateTime.slice(0, 10); // YYYY-MM-DD
  if (granularity === 'day') return day;
  if (granularity === 'month') return day.slice(0, 7); // YYYY-MM
  // week: the Monday of that ISO week, as its own YYYY-MM-DD.
  const date = new Date(`${day}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

export type TrendPoint = { bucket: string; value: number };

/** Lead volume per bucket — count of leads whose createdAt falls in each bucket. */
export function groupLeadsByPeriod(leads: Lead[], granularity: TrendGranularity): TrendPoint[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const key = bucketKey(lead.createdAt, granularity);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([bucket, value]) => ({ bucket, value })).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** Attributed revenue per bucket — sum of RevenueRecord.amount whose
 * occurredAt falls in each bucket. Never reads Lead.conversionValue. */
export function groupRevenueByPeriod(records: RevenueRecord[], granularity: TrendGranularity): TrendPoint[] {
  const totals = new Map<string, number>();
  for (const record of records) {
    const key = bucketKey(record.occurredAt, granularity);
    totals.set(key, (totals.get(key) ?? 0) + record.amount);
  }
  return [...totals.entries()].map(([bucket, value]) => ({ bucket, value })).sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/** Short chart-axis label for a bucket key, in es-ES. */
export function formatTrendBucketLabel(bucket: string, granularity: TrendGranularity): string {
  if (granularity === 'month') {
    const date = new Date(`${bucket}-01T00:00:00.000Z`);
    return date.toLocaleDateString('es-ES', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  const date = new Date(`${bucket}T00:00:00.000Z`);
  const label = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return granularity === 'week' ? `sem. ${label}` : label;
}

// ===== Funnel derivation =====

const STAGE_RANK: Record<LeadStage, number> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  appointment: 3,
  converted: 4,
  no_response: -1,
  disqualified: -1,
};

/**
 * How far a lead has ever been proven to reach, combining two signals:
 *
 * (1) its current `stage` — a single, non-historical value that CAN regress
 *     (e.g. qualified -> disqualified), so reading it alone UNDERcounts a
 *     lead that reached a stage and later fell out of it; and
 * (2) its LeadEvent history (stage_changed/appointment_booked/
 *     appointment_completed/converted) — reliably timestamped, but the
 *     seeded demo data (lib/leads.ts) proves this log is NOT exhaustive:
 *     lead-demo-4 is seeded at stage 'converted' with only lead_received,
 *     ai_analyzed and appointment_completed events (no stage_changed to
 *     qualified/appointment/converted at all), and lead-demo-5 is seeded at
 *     stage 'new' despite having a 'converted' event on record. Relying on
 *     events alone would report both as never having reached qualified.
 *
 * Taking the max of both is the only derivation that doesn't silently zero
 * out real, already-persisted progress. This is a deliberate fallback for
 * incomplete seed/event history, not a way to manufacture data: every signal
 * consulted here already exists in the repository today.
 */
function maxReachedStageRank(lead: Lead, events: LeadEvent[]): number {
  let max = STAGE_RANK[lead.stage] ?? -1;
  for (const event of events) {
    if (event.type === 'stage_changed') {
      const to = (event.details as { to?: string } | null | undefined)?.to;
      const rank = to ? STAGE_RANK[to as LeadStage] : undefined;
      if (rank != null && rank > max) max = rank;
    } else if (event.type === 'converted') {
      if (STAGE_RANK.converted > max) max = STAGE_RANK.converted;
    } else if (event.type === 'appointment_booked' || event.type === 'appointment_completed') {
      if (STAGE_RANK.appointment > max) max = STAGE_RANK.appointment;
    }
  }
  return max;
}

export type LeadFunnelCounts = {
  leads: number;
  qualified: number;
  appointments: number; // "Citas" — booked (or beyond), not necessarily attended
  attended: number; // "Asistidas"
  converted: number;
};

/**
 * Distinct-lead counts for the CRM funnel. `cohortLeads` should already be
 * period+client filtered by the caller (see filterLeadsByPeriod) — the cohort
 * is then followed forward through its FULL event history with no period
 * bound on the events themselves, per the approved cohort semantics: this
 * answers "what happened to leads acquired in this period," not "what events
 * happened during this period." Every count is a count of DISTINCT lead ids,
 * never raw events — a lead with two appointment_booked events (reschedule)
 * still counts once for "Citas".
 */
export function buildLeadFunnel(cohortLeads: Lead[], allEvents: LeadEvent[]): LeadFunnelCounts {
  const eventsByLead = new Map<string, LeadEvent[]>();
  for (const event of allEvents) {
    const list = eventsByLead.get(event.leadId);
    if (list) list.push(event);
    else eventsByLead.set(event.leadId, [event]);
  }

  let qualified = 0;
  let appointments = 0;
  let converted = 0;
  let attended = 0;

  for (const lead of cohortLeads) {
    const events = eventsByLead.get(lead.id) ?? [];
    const rank = maxReachedStageRank(lead, events);
    if (rank >= STAGE_RANK.qualified) qualified += 1;
    if (rank >= STAGE_RANK.appointment) appointments += 1;
    if (rank >= STAGE_RANK.converted) converted += 1;
    // Attendance is its own axis — NEVER inferred from stage rank, only ever
    // from an explicit appointment_completed event. A converted/appointment
    // lead with no logged completion did not provably attend.
    if (events.some((event) => event.type === 'appointment_completed')) attended += 1;
  }

  return { leads: cohortLeads.length, qualified, appointments, attended, converted };
}

/** Sums per-client funnel counts into an agency-wide funnel — for the global
 * "FUNNEL COMERCIAL" view. Simple field-wise addition; distinct-lead
 * de-duplication already happened per-client inside buildLeadFunnel, and
 * leads belong to exactly one client, so summing across clients cannot
 * double-count a lead. */
export function sumFunnelCounts(countsList: LeadFunnelCounts[]): LeadFunnelCounts {
  return countsList.reduce(
    (acc, counts) => ({
      leads: acc.leads + counts.leads,
      qualified: acc.qualified + counts.qualified,
      appointments: acc.appointments + counts.appointments,
      attended: acc.attended + counts.attended,
      converted: acc.converted + counts.converted,
    }),
    { leads: 0, qualified: 0, appointments: 0, attended: 0, converted: 0 },
  );
}

export type FunnelStageId = 'leads' | 'qualified' | 'appointments' | 'attended' | 'converted';

export type FunnelStageRow = {
  id: FunnelStageId;
  label: string;
  count: number;
  /** Rate vs. the immediately previous row — null when there is no previous
   * row, or the previous row's count is 0 (never a division by zero, never
   * a fabricated 0%). */
  rateFromPrevious: number | null;
};

const FUNNEL_STAGE_LABELS: Record<FunnelStageId, string> = {
  leads: 'Leads',
  qualified: 'Cualificados',
  appointments: 'Citas',
  attended: 'Asistidas',
  converted: 'Conversiones',
};

export function buildFunnelStages(counts: LeadFunnelCounts): FunnelStageRow[] {
  const order: { id: FunnelStageId; count: number }[] = [
    { id: 'leads', count: counts.leads },
    { id: 'qualified', count: counts.qualified },
    { id: 'appointments', count: counts.appointments },
    { id: 'attended', count: counts.attended },
    { id: 'converted', count: counts.converted },
  ];

  return order.map((stage, index) => {
    const previous = index === 0 ? null : order[index - 1].count;
    const rateFromPrevious = previous ? stage.count / previous : null;
    return { id: stage.id, label: FUNNEL_STAGE_LABELS[stage.id], count: stage.count, rateFromPrevious };
  });
}

// ===== Ad spend availability =====

/**
 * Ad spend is only ever computed for preset === 'all' (Todo). MetaCampaign
 * .spend is a LIFETIME CUMULATIVE total per campaign — there is no
 * daily/historical spend time series anywhere in the repo. Approximating a
 * period's spend by campaign startDate would misrepresent CAC/ROAS as more
 * precise than the underlying data supports, so V1 deliberately reports
 * spend (and everything derived from it: CPL, CAC, ROAS) as unavailable
 * outside the all-time view. See getAdSpendUnavailableNote for the UI copy.
 */
export function resolveAdSpend(campaigns: MetaCampaign[], preset: PeriodPreset): number | null {
  if (preset !== 'all') return null;
  return campaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
}

export function getAdSpendUnavailableNote(): string {
  return 'El gasto publicitario por periodo estará disponible cuando Meta Ads disponga de datos históricos sincronizados.';
}

// ===== KPI formulas (never persisted) =====

export function sumAttributedRevenue(records: RevenueRecord[]): number {
  return records.reduce((sum, record) => sum + record.amount, 0);
}

/** adSpend / CRM converted leads. Null ("—") when spend is unavailable or
 * there are zero conversions. Labelled "CAC publicitario" in the UI — this
 * number only reflects ad spend, never a fully-loaded business CAC. */
export function computeCACPublicitario(adSpend: number | null, convertedLeads: number): number | null {
  if (adSpend == null || convertedLeads <= 0) return null;
  return adSpend / convertedLeads;
}

/**
 * attributedRevenue / adSpend. Null ("—") when spend is unavailable, spend is
 * zero, or attributed revenue is zero — a zero revenue total is treated the
 * same as "not entered yet," never as a confirmed zero return, matching the
 * honesty rule lib/finances.ts uses for unwired income accounts (null, never
 * a misleading zero).
 */
export function computeROAS(attributedRevenue: number, adSpend: number | null): number | null {
  if (adSpend == null || adSpend <= 0 || attributedRevenue <= 0) return null;
  return attributedRevenue / adSpend;
}

/** Gasto / Leads CRM — CRM-side cost-per-lead. Distinct from
 * MetaCampaign's own getCampaignCPL (spend / Meta-attributed leads,
 * lib/meta-ads.ts) — never mix the two; label whichever is shown explicitly. */
export function computeCPLCrm(adSpend: number | null, crmLeads: number): number | null {
  if (adSpend == null || crmLeads <= 0) return null;
  return adSpend / crmLeads;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function qualificationRate(counts: LeadFunnelCounts): number | null {
  return rate(counts.qualified, counts.leads);
}
export function bookingRate(counts: LeadFunnelCounts): number | null {
  return rate(counts.appointments, counts.qualified);
}
export function attendanceRate(counts: LeadFunnelCounts): number | null {
  return rate(counts.attended, counts.appointments);
}
export function closeRate(counts: LeadFunnelCounts): number | null {
  return rate(counts.converted, counts.leads);
}

// ===== Global aggregation (sum totals, never average per-client ratios) =====

export type ClientResultsTotals = {
  adSpend: number | null;
  crmLeads: number;
  converted: number;
  attributedRevenue: number;
};

export type AggregateResultsTotals = {
  adSpend: number | null;
  crmLeads: number;
  converted: number;
  attributedRevenue: number;
  roas: number | null;
  cac: number | null;
};

/**
 * Aggregates per-client totals into agency-wide totals, then derives
 * ROAS/CAC from those SUMMED totals — never by averaging each client's own
 * ROAS/CAC, which would over-weight small clients. Same principle as
 * lib/meta-ads.ts's summarizeCampaigns.
 */
export function aggregateResultsTotals(perClient: ClientResultsTotals[]): AggregateResultsTotals {
  const spendUnavailable = perClient.some((client) => client.adSpend == null);
  const totalSpend = spendUnavailable ? null : perClient.reduce((sum, client) => sum + (client.adSpend ?? 0), 0);

  const totals = perClient.reduce(
    (acc, client) => ({
      crmLeads: acc.crmLeads + client.crmLeads,
      converted: acc.converted + client.converted,
      attributedRevenue: acc.attributedRevenue + client.attributedRevenue,
    }),
    { crmLeads: 0, converted: 0, attributedRevenue: 0 },
  );

  return {
    adSpend: totalSpend,
    ...totals,
    roas: computeROAS(totals.attributedRevenue, totalSpend),
    cac: computeCACPublicitario(totalSpend, totals.converted),
  };
}

// ===== Client-level orchestration =====
// The single source of truth for "everything Results shows about one
// client" — both /results (via buildClientComparison, below) and
// /clients/[clientId]/results call this, so the two surfaces can never
// silently disagree on a number.

export type ClientResultsComputation = {
  clientId: string;
  cohortLeads: Lead[];
  counts: LeadFunnelCounts;
  stages: FunnelStageRow[];
  adSpend: number | null;
  /** Meta-attributed leads (MetaCampaign.leads) — reference only, same
   * lifetime-cumulative availability rule as adSpend. Never summed with
   * counts.leads (CRM leads). */
  metaLeads: number | null;
  revenueRecordsInPeriod: RevenueRecord[];
  attributedRevenue: number;
  roas: number | null;
  cac: number | null;
  cplCrm: number | null;
};

export function computeClientResults(
  clientId: string,
  allLeads: Lead[],
  allEvents: LeadEvent[],
  allCampaigns: MetaCampaign[],
  allRevenue: RevenueRecord[],
  period: ResultsPeriod,
  preset: PeriodPreset,
): ClientResultsComputation {
  const clientLeads = allLeads.filter((lead) => lead.clientId === clientId);
  const cohortLeads = filterLeadsByPeriod(clientLeads, period);
  const counts = buildLeadFunnel(cohortLeads, allEvents);
  const stages = buildFunnelStages(counts);

  const clientCampaigns = allCampaigns.filter((campaign) => campaign.clientId === clientId);
  const adSpend = resolveAdSpend(clientCampaigns, preset);
  const metaLeads = preset === 'all' ? clientCampaigns.reduce((sum, campaign) => sum + campaign.leads, 0) : null;

  const clientRevenue = allRevenue.filter((record) => record.clientId === clientId);
  const revenueRecordsInPeriod = filterRevenueRecordsByPeriod(clientRevenue, period);
  const attributedRevenue = sumAttributedRevenue(revenueRecordsInPeriod);

  return {
    clientId,
    cohortLeads,
    counts,
    stages,
    adSpend,
    metaLeads,
    revenueRecordsInPeriod,
    attributedRevenue,
    roas: computeROAS(attributedRevenue, adSpend),
    cac: computeCACPublicitario(adSpend, counts.converted),
    cplCrm: computeCPLCrm(adSpend, counts.leads),
  };
}

// ===== Client comparison / ranking (for the global portfolio view) =====

export type ClientComparisonRow = {
  clientId: string;
  clientName: string;
  adSpend: number | null;
  crmLeads: number;
  converted: number;
  attributedRevenue: number;
  roas: number | null;
  cac: number | null;
};

/**
 * One ranking row per client, sorted by attributed revenue (largest first).
 * Each row's own ROAS/CAC is computed independently — fine for a per-client
 * ranking display. The separate AGGREGATE total across all clients must
 * still come from aggregateResultsTotals, never from averaging these rows.
 */
export function buildClientComparison(
  clients: { id: string; name: string }[],
  perClient: Pick<ClientResultsComputation, 'clientId' | 'adSpend' | 'counts' | 'attributedRevenue' | 'roas' | 'cac'>[],
): ClientComparisonRow[] {
  const byClientId = new Map(perClient.map((computation) => [computation.clientId, computation]));
  return clients
    .map((client) => {
      const computation = byClientId.get(client.id);
      return {
        clientId: client.id,
        clientName: client.name,
        adSpend: computation?.adSpend ?? null,
        crmLeads: computation?.counts.leads ?? 0,
        converted: computation?.counts.converted ?? 0,
        attributedRevenue: computation?.attributedRevenue ?? 0,
        roas: computation?.roas ?? null,
        cac: computation?.cac ?? null,
      };
    })
    .sort((a, b) => b.attributedRevenue - a.attributedRevenue);
}

// ===== Demo data detection =====
// Only RevenueRecord and MetaCampaign carry a `dataSource` field in this
// repository — Lead and Client do not (see lib/leads.ts / lib/clients.ts).
// So this can only ever honestly detect demo-ness from the two sources that
// actually declare it; it does not (and cannot, without inventing a new
// field on modules outside Results' scope) know whether a given Lead is
// seeded demo data. Documented here rather than silently overclaiming.

export function hasDemoRevenueRecords(records: RevenueRecord[]): boolean {
  return records.some((record) => record.dataSource === 'demo');
}

export function hasDemoCampaigns(campaigns: MetaCampaign[]): boolean {
  return campaigns.some((campaign) => campaign.dataSource === 'demo');
}

export function includesDemoData(input: { revenueRecords?: RevenueRecord[]; campaigns?: MetaCampaign[] }): boolean {
  return hasDemoRevenueRecords(input.revenueRecords ?? []) || hasDemoCampaigns(input.campaigns ?? []);
}

// ===== Formatting =====
// V1 is EUR-only — no currency field exists anywhere in REKREATIVE (Client,
// MetaCampaign, Lead), so Results assumes the same implicit single currency
// rather than introducing FX/multi-currency handling.

export function formatEUR(value: number): string {
  return `${Math.round(value).toLocaleString('es-ES')} €`;
}

export function formatRoas(value: number | null): string {
  if (value == null) return '—';
  return `${value.toFixed(1).replace('.', ',')}x`;
}

export function formatRate(value: number | null): string {
  if (value == null) return '—';
  return `${Math.round(value * 100)}%`;
}

import { getClients } from '@/lib/clients';
import type { Lead, LeadEvent } from '@/lib/leads';
import type { MetaCampaign } from '@/lib/meta-ads';
import {
  bucketKey,
  buildFunnelStages,
  buildLeadFunnel,
  type FunnelStageRow,
  type LeadFunnelCounts,
  type TrendGranularity,
  type TrendPoint,
} from '@/lib/results-domain';

export {
  STAGE_RANK,
  maxReachedStageRank,
  buildLeadFunnel,
  sumFunnelCounts,
  buildFunnelStages,
  qualificationRate,
  bookingRate,
  attendanceRate,
  closeRate,
  groupLeadsByPeriod,
  formatTrendBucketLabel,
  sumConvertedValue,
} from '@/lib/results-domain';
export type {
  LeadFunnelCounts,
  FunnelStageId,
  FunnelStageRow,
  TrendGranularity,
  TrendPoint,
  ConvertedValueSummary,
} from '@/lib/results-domain';

// Results V1 — "What business outcome is REKREATIVE generating for this
// client?" Everything here is either (a) the RevenueRecord type/pure helpers,
// or (b) a pure function deriving funnel/KPI numbers from RevenueRecord + the
// existing lib/leads.ts + lib/meta-ads.ts data. No KPI is ever persisted —
// same discipline as getCampaignCPL/getAutomationHealth/
// getIntegrationConfigurationStatus.
//
// Results Manual Revenue V1 — RevenueRecord persistence moved to PostgreSQL
// (lib/server/revenue-records-repo.ts, via lib/api/revenue-records.ts). This
// module keeps only the type and pure functions that never touched
// localStorage directly (period/trend/formatting/dedup-prep), still reused
// unchanged by both the new API client and the (untouched) legacy
// computeClientResults/aggregateResultsTotals calculation path below.
//
// Funnel counting / rates / trend-bucketing were extracted to
// lib/results-domain.ts (pure, window-free) so lib/server/results-repo.ts
// can reuse the exact same rules server-side — re-exported above so every
// existing import of these names from '@/lib/results' keeps working
// unchanged.

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
  /** Only 'manual' is producible by the API in V1 (see lib/server/revenue-records-repo.ts). */
  source: RevenueRecordSource;
  /** Dedup key for a future automated sync. Always null for manual entries. */
  externalRef: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  dataSource: RevenueRecordDataSource;
};

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
  return `${Math.round(value).toLocaleString('es-ES', { useGrouping: true })} €`;
}

export function formatRoas(value: number | null): string {
  if (value == null) return '—';
  return `${value.toFixed(1).replace('.', ',')}x`;
}

export function formatRate(value: number | null): string {
  if (value == null) return '—';
  return `${Math.round(value * 100)}%`;
}

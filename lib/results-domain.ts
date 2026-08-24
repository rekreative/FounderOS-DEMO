import type { Lead, LeadEvent, LeadStage } from '@/lib/leads';

/**
 * Pure, environment-independent Results domain logic — funnel counting,
 * rates, conversion-value aggregation, and trend bucketing. Extracted out of
 * lib/results.ts (which also holds the browser-localStorage RevenueRecord
 * model) so lib/server/results-repo.ts can import ONLY this — no
 * window/localStorage/getClients dependency ever reaches the server bundle.
 * lib/results.ts re-exports everything here for backward compatibility, so
 * no existing import path (components, tests) needs to change.
 *
 * Every rule below is unchanged from its original lib/results.ts version —
 * this file is a relocation, not a rewrite — except sumConvertedValue, which
 * is new (Results V1 never read Lead.conversionValue at all).
 */

// ===== Funnel derivation =====

export const STAGE_RANK: Record<LeadStage, number> = {
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
 *     appointment_completed/converted) — reliably timestamped, but not
 *     guaranteed exhaustive for every lead.
 *
 * Taking the max of both is the only derivation that doesn't silently zero
 * out real, already-persisted progress.
 */
export function maxReachedStageRank(lead: Lead, events: LeadEvent[]): number {
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
 * period+client filtered by the caller — the cohort is then followed forward
 * through its FULL event history with no period bound on the events
 * themselves (see the acquisition-cohort semantics in lib/server/
 * results-repo.ts). Every count is a count of DISTINCT lead ids, never raw
 * events — a lead with two appointment_booked events (reschedule) still
 * counts once for "Citas"; a lead with two converted events still counts
 * once for "Conversiones".
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
    // from an explicit appointment_completed event.
    if (events.some((event) => event.type === 'appointment_completed')) attended += 1;
  }

  return { leads: cohortLeads.length, qualified, appointments, attended, converted };
}

/** Sums per-client funnel counts into an agency-wide funnel. Simple
 * field-wise addition; distinct-lead de-duplication already happened
 * per-client inside buildLeadFunnel, and leads belong to exactly one client,
 * so summing across clients cannot double-count a lead. */
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

// ===== Conversion value aggregation (Results V1 — new) =====

export type ConvertedValueSummary = {
  /** Sum of conversionValue over cohort leads that reached 'converted' AND
   * carry a non-null value. Null (never 0) when no such lead exists. */
  total: number | null;
  /** total / count. Null when count is 0. */
  average: number | null;
  /** How many converted leads actually had a conversionValue to sum —
   * the honest denominator for `average`, distinct from the funnel's overall
   * `converted` count (a converted lead can still have a null conversionValue
   * if the amount was never recorded). */
  count: number;
};

/**
 * Sums Lead.conversionValue over the SAME distinct-lead "converted"
 * classification buildLeadFunnel uses (maxReachedStageRank >=
 * STAGE_RANK.converted) — one dedup rule for both, so a lead with two
 * `converted` events is still summed once, using its own single
 * conversionValue field (never per-event).
 */
export function sumConvertedValue(cohortLeads: Lead[], allEvents: LeadEvent[]): ConvertedValueSummary {
  const eventsByLead = new Map<string, LeadEvent[]>();
  for (const event of allEvents) {
    const list = eventsByLead.get(event.leadId);
    if (list) list.push(event);
    else eventsByLead.set(event.leadId, [event]);
  }

  const values: number[] = [];
  for (const lead of cohortLeads) {
    const events = eventsByLead.get(lead.id) ?? [];
    const rank = maxReachedStageRank(lead, events);
    if (rank >= STAGE_RANK.converted && lead.conversionValue != null) {
      values.push(lead.conversionValue);
    }
  }

  if (values.length === 0) return { total: null, average: null, count: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  return { total, average: total / values.length, count: values.length };
}

// ===== Trend grouping (time-bucketed charts) =====

export type TrendGranularity = 'day' | 'week' | 'month';

export function bucketKey(isoDateTime: string, granularity: TrendGranularity): string {
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

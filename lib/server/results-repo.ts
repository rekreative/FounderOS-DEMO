import type { LeadEvent, LeadScope } from '@/lib/leads';
import {
  attendanceRate,
  bookingRate,
  buildFunnelStages,
  buildLeadFunnel,
  closeRate,
  groupLeadsByPeriod,
  qualificationRate,
  sumConvertedValue,
  type ConvertedValueSummary,
  type FunnelStageRow,
  type LeadFunnelCounts,
  type TrendGranularity,
  type TrendPoint,
} from '@/lib/results-domain';
import { query } from './db';
import {
  listLeadEventsForLeadIds,
  listLeads,
  rowToLead,
  rowToLeadEvent,
  type LeadEventRow,
  type LeadRow,
  type ServerLead,
} from './leads-repo';
import {
  resolveResultsPeriod,
  resolveResultsTrendGranularity,
  trailingDaysWindow,
  type ResolvedResultsPeriod,
  type ResultsPeriodPreset,
} from './results-time';

/**
 * The canonical Results + Home aggregation layer (Results Real + Home Real
 * V1). Every function here is a bounded query (never "fetch everything, then
 * N+1 per row") built on lib/server/leads-repo.ts's primitives, reduced with
 * the same pure funnel/rate/value rules lib/results-domain.ts already
 * validates for the client-side revenue/campaign path — one set of counting
 * rules, reused, not reimplemented in SQL.
 */

// ── Results (acquisition-cohort funnel) ───────────────────────────────────

async function loadCohort(options: {
  clientId?: string;
  scope?: LeadScope;
  createdFrom?: Date;
  createdTo?: Date;
}): Promise<{ leads: ServerLead[]; eventsByLead: Map<string, LeadEvent[]> }> {
  const leads = await listLeads({
    clientId: options.clientId,
    scope: options.scope,
    createdFrom: options.createdFrom,
    createdTo: options.createdTo,
  });
  const events = await listLeadEventsForLeadIds(leads.map((lead) => lead.id));
  const eventsByLead = new Map<string, LeadEvent[]>();
  for (const event of events) {
    const list = eventsByLead.get(event.leadId);
    if (list) list.push(event);
    else eventsByLead.set(event.leadId, [event]);
  }
  return { leads, eventsByLead };
}

export type ResultsComputation = {
  clientId: string | null;
  funnel: LeadFunnelCounts;
  stages: FunnelStageRow[];
  rates: {
    qualification: number | null;
    booking: number | null;
    attendance: number | null;
    close: number | null;
  };
  value: ConvertedValueSummary;
  trend: { granularity: TrendGranularity; points: TrendPoint[] };
};

function computeCohortResult(
  clientId: string | null,
  cohortLeads: ServerLead[],
  eventsByLead: Map<string, LeadEvent[]>,
  period: ResolvedResultsPeriod,
): ResultsComputation {
  // Reconstructs the flat event list buildLeadFunnel/sumConvertedValue
  // expect — cheap (already in memory, no new query) and keeps those
  // functions' existing signature untouched.
  const events = cohortLeads.flatMap((lead) => eventsByLead.get(lead.id) ?? []);
  const funnel = buildLeadFunnel(cohortLeads, events);
  const stages = buildFunnelStages(funnel);
  const rates = {
    qualification: qualificationRate(funnel),
    booking: bookingRate(funnel),
    attendance: attendanceRate(funnel),
    close: closeRate(funnel),
  };
  const value = sumConvertedValue(cohortLeads, events);
  const granularity = resolveResultsTrendGranularity(period.preset, { start: period.start, end: period.end });
  const trend = { granularity, points: groupLeadsByPeriod(cohortLeads, granularity) };
  return { clientId, funnel, stages, rates, value, trend };
}

export type ResultsQueryOptions = {
  /** Omitted = global REKREATIVE view (every client, plus a byClient breakdown). */
  clientId?: string;
  preset: ResultsPeriodPreset;
  customStart?: string;
  customEnd?: string;
};

export type ResultsResult = {
  period: ResolvedResultsPeriod;
  overall: ResultsComputation;
  /** Per-client breakdown. A single-element array (== [overall]) when
   * `clientId` was given; one entry per client with at least one cohort lead
   * otherwise. */
  byClient: ResultsComputation[];
};

/**
 * Acquisition-cohort Results: the cohort is leads whose created_at falls in
 * the resolved period (Madrid-anchored). Events are fetched for those leads
 * with NO date restriction — a lead created inside the period that converts
 * after it is still counted as converted in this cohort; a lead created
 * outside the period never enters it, regardless of when it later converts.
 */
export async function getResults(options: ResultsQueryOptions): Promise<ResultsResult> {
  const period = resolveResultsPeriod(
    options.preset,
    options.customStart && options.customEnd ? { start: options.customStart, end: options.customEnd } : undefined,
  );
  const createdFrom = period.queryStart ?? undefined;
  const createdTo = period.queryEndExclusive ?? undefined;

  if (options.clientId) {
    const { leads, eventsByLead } = await loadCohort({ clientId: options.clientId, createdFrom, createdTo });
    const computation = computeCohortResult(options.clientId, leads, eventsByLead, period);
    return { period, overall: computation, byClient: [computation] };
  }

  // Global view — REKREATIVE's own internal leads (scope 'internal',
  // clientId null) never belong to a client cohort, same exclusion the
  // client-side computeClientResults already applied via `lead.clientId ===
  // clientId`; fetching only scope 'client' here is the SQL-side equivalent.
  const { leads, eventsByLead } = await loadCohort({ scope: 'client', createdFrom, createdTo });

  const leadsByClient = new Map<string, ServerLead[]>();
  for (const lead of leads) {
    if (!lead.clientId) continue;
    const list = leadsByClient.get(lead.clientId);
    if (list) list.push(lead);
    else leadsByClient.set(lead.clientId, [lead]);
  }

  const byClient = [...leadsByClient.entries()].map(([clientId, clientLeads]) =>
    computeCohortResult(clientId, clientLeads, eventsByLead, period),
  );
  const overall = computeCohortResult(null, leads, eventsByLead, period);
  return { period, overall, byClient };
}

// ── Home (operational, current-activity — event-time semantics) ──────────
// Deliberately NOT cohort/created_at-filtered: Home answers "what is
// happening right now", not "what happened to leads acquired in a period".

export async function getRecentLeads(limit: number): Promise<ServerLead[]> {
  const result = await query<LeadRow>('SELECT * FROM leads ORDER BY created_at DESC LIMIT $1', [limit]);
  return result.rows.map(rowToLead);
}

/** (ai_priority = high OR ai_intent = hot) AND stage IN (new, contacted) —
 * exactly the approved rule, no invented severity/SLA logic. */
export async function getHighPriorityLeads(limit: number): Promise<ServerLead[]> {
  const result = await query<LeadRow>(
    `SELECT * FROM leads
     WHERE (ai_priority = 'high' OR ai_intent = 'hot') AND stage IN ('new', 'contacted')
     ORDER BY last_activity_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(rowToLead);
}

/** stage = new AND no whatsapp_sent event — exactly the approved rule.
 * Ordered oldest-first: the longest-waiting lead is the most urgent one. */
export async function getLeadsAwaitingFirstContact(limit: number): Promise<ServerLead[]> {
  const result = await query<LeadRow>(
    `SELECT l.* FROM leads l
     WHERE l.stage = 'new'
       AND NOT EXISTS (SELECT 1 FROM lead_events e WHERE e.lead_id = l.id AND e.type = 'whatsapp_sent')
     ORDER BY l.created_at ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(rowToLead);
}

export async function getUpcomingAppointments(limit: number): Promise<ServerLead[]> {
  const result = await query<LeadRow>(
    `SELECT * FROM leads
     WHERE stage = 'appointment' AND appointment_date IS NOT NULL AND appointment_date >= now()
     ORDER BY appointment_date ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(rowToLead);
}

export type RecentConversion = { lead: ServerLead; convertedAt: string };

/**
 * Most recent `converted` event per lead (DISTINCT ON lead_id, latest
 * occurred_at) — a lead with multiple converted events still appears once,
 * at its most recent conversion timestamp.
 */
export async function getRecentConversions(limit: number): Promise<RecentConversion[]> {
  const result = await query<LeadRow & { converted_at: Date }>(
    `SELECT l.*, sub.converted_at
     FROM (
       SELECT DISTINCT ON (lead_id) lead_id, occurred_at AS converted_at
       FROM lead_events
       WHERE type = 'converted'
       ORDER BY lead_id, occurred_at DESC
     ) sub
     JOIN leads l ON l.id = sub.lead_id
     ORDER BY sub.converted_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({ lead: rowToLead(row), convertedAt: row.converted_at.toISOString() }));
}

export type RecentActivityEntry = { event: LeadEvent; leadName: string; leadClientId: string | null };

export async function getRecentActivity(limit: number): Promise<RecentActivityEntry[]> {
  const result = await query<LeadEventRow & { lead_name: string; lead_client_id: string | null }>(
    `SELECT e.*, l.name AS lead_name, l.client_id AS lead_client_id
     FROM lead_events e
     JOIN leads l ON l.id = e.lead_id
     ORDER BY e.occurred_at DESC, e.created_at DESC, e.id DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    event: rowToLeadEvent(row),
    leadName: row.lead_name,
    leadClientId: row.lead_client_id,
  }));
}

/**
 * SUM/AVG of Lead.conversionValue for leads with a `converted` event inside
 * the trailing `days`-day Madrid window — event-time, not lead.createdAt.
 * Distinct-lead: the inner subquery is keyed on lead_id, so a lead with two
 * converted events in the window is still summed once. Null (never 0) when
 * no converted lead in the window has a recorded value.
 */
export async function getValueGeneratedRecently(
  days: number,
  now: Date = new Date(),
): Promise<{ total: number | null; average: number | null; count: number }> {
  const window = trailingDaysWindow(days, now);
  const result = await query<{ total: string | null; average: string | null; count: string }>(
    `SELECT SUM(l.conversion_value) AS total, AVG(l.conversion_value) AS average, COUNT(l.conversion_value) AS count
     FROM leads l
     WHERE l.conversion_value IS NOT NULL
       AND l.id IN (
         SELECT DISTINCT lead_id FROM lead_events
         WHERE type = 'converted' AND occurred_at >= $1 AND occurred_at <= $2
       )`,
    [window.start, window.end],
  );
  const row = result.rows[0];
  const count = Number(row?.count ?? 0);
  if (count === 0) return { total: null, average: null, count: 0 };
  return { total: Number(row.total), average: Number(row.average), count };
}

export type ClientOperationalSnapshot = {
  clientId: string;
  leads: number;
  appointments: number;
  conversions: number;
  valueGenerated: number | null;
};

/** All-time (not cohort/period-bound) per-client funnel snapshot for Home's
 * client table — Client / Leads / Appointments / Conversions / Value
 * generated. Same dedup rules as Results (buildLeadFunnel/sumConvertedValue),
 * just never date-filtered. */
export async function getClientOperationalSnapshot(): Promise<ClientOperationalSnapshot[]> {
  const { leads, eventsByLead } = await loadCohort({ scope: 'client' });

  const leadsByClient = new Map<string, ServerLead[]>();
  for (const lead of leads) {
    if (!lead.clientId) continue;
    const list = leadsByClient.get(lead.clientId);
    if (list) list.push(lead);
    else leadsByClient.set(lead.clientId, [lead]);
  }

  return [...leadsByClient.entries()].map(([clientId, clientLeads]) => {
    const events = clientLeads.flatMap((lead) => eventsByLead.get(lead.id) ?? []);
    const funnel = buildLeadFunnel(clientLeads, events);
    const value = sumConvertedValue(clientLeads, events);
    return { clientId, leads: funnel.leads, appointments: funnel.appointments, conversions: funnel.converted, valueGenerated: value.total };
  });
}

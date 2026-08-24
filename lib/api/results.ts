import type { FunnelStageRow, LeadFunnelCounts, TrendGranularity, TrendPoint } from '@/lib/results-domain';
import type { LeadEvent } from '@/lib/leads';
import type { Lead } from './leads';
import { apiFetch } from './http';

/**
 * Browser-facing HTTP client for the canonical Results/Home aggregation
 * layer (lib/server/results-repo.ts, GET /api/results, GET
 * /api/results/home). Never imports lib/server/*. Distinct from lib/results.ts,
 * which still owns the browser-localStorage RevenueRecord/MetaCampaign
 * models — this module only ever returns real PostgreSQL-derived numbers.
 */

export type ResultsPeriodPreset = 'all' | 'this_month' | 'last_month' | 'last_30_days' | 'custom';

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
  value: { total: number | null; average: number | null; count: number };
  trend: { granularity: TrendGranularity; points: TrendPoint[] };
};

export type ResultsResponse = {
  period: { preset: ResultsPeriodPreset; start: string | null; end: string | null };
  overall: ResultsComputation;
  byClient: ResultsComputation[];
};

export type GetResultsOptions = {
  clientId?: string;
  preset?: ResultsPeriodPreset;
  start?: string;
  end?: string;
};

export async function getResults(options: GetResultsOptions = {}): Promise<ResultsResponse> {
  const params = new URLSearchParams();
  if (options.clientId) params.set('clientId', options.clientId);
  if (options.preset) params.set('preset', options.preset);
  if (options.start) params.set('start', options.start);
  if (options.end) params.set('end', options.end);
  const qs = params.toString();
  return apiFetch<ResultsResponse>(`/api/results${qs ? `?${qs}` : ''}`);
}

export type RecentConversion = { lead: Lead; convertedAt: string };
export type RecentActivityEntry = { event: LeadEvent; leadName: string; leadClientId: string | null };
export type ClientOperationalSnapshot = {
  clientId: string;
  leads: number;
  appointments: number;
  conversions: number;
  valueGenerated: number | null;
};

export type ResultsHomeResponse = {
  recentLeads: Lead[];
  highPriorityLeads: Lead[];
  awaitingFirstContact: Lead[];
  upcomingAppointments: Lead[];
  recentConversions: RecentConversion[];
  recentActivity: RecentActivityEntry[];
  valueGenerated: { total: number | null; average: number | null; count: number; days: number };
  clientSnapshot: ClientOperationalSnapshot[];
};

export async function getResultsHomeSnapshot(options: { limit?: number; days?: number } = {}): Promise<ResultsHomeResponse> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.days) params.set('days', String(options.days));
  const qs = params.toString();
  return apiFetch<ResultsHomeResponse>(`/api/results/home${qs ? `?${qs}` : ''}`);
}

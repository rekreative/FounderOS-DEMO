import type { TrendGranularity } from '@/lib/results-domain';

/**
 * The smallest possible Europe/Madrid boundary solution for Backend V1 —
 * no date library. PostgreSQL TIMESTAMPTZ columns already store the correct
 * UTC instant; the only gap was application-layer "what day is 'today'"
 * math, which lib/results.ts's client-side resolvePeriod does in naive UTC.
 * This module answers that question for REKREATIVE's actual timezone,
 * server-side, for the real Postgres-backed cohort queries only — the
 * existing UTC-based client logic (RevenueRecord/MetaCampaign period
 * filtering) is untouched, out of scope, and still valid for what it does.
 */

export const RESULTS_TIME_ZONE = 'Europe/Madrid';

/** The Madrid calendar date (YYYY-MM-DD) a given instant falls on. */
export function madridDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: RESULTS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * The UTC instant of local midnight for `dateStr` in `timeZone`. Works for
 * any IANA zone/DST transition without a library: format the same naive UTC
 * guess as wall-clock strings in both `timeZone` and 'UTC' (both parsed back
 * with `new Date(string)`, which uses the host's local timezone for BOTH —
 * so that host-dependent parsing cancels out in the difference), and shift
 * the guess by the difference between the two.
 */
function startOfDayUtc(dateStr: string, timeZone: string): Date {
  const guess = new Date(`${dateStr}T00:00:00.000Z`);
  const asZoned = new Date(guess.toLocaleString('en-US', { timeZone }));
  const asUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = asUtc.getTime() - asZoned.getTime();
  return new Date(guess.getTime() + offsetMs);
}

export function startOfMadridDayUtc(dateStr: string): Date {
  return startOfDayUtc(dateStr, RESULTS_TIME_ZONE);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Pure Y-M-D calendar arithmetic — never timezone-sensitive itself, only
 * the eventual conversion to a UTC instant (startOfMadridDayUtc) is. */
function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** Last calendar day of a given 1-based month, as YYYY-MM-DD. */
function lastDayOfMonth(year: number, month1based: number): string {
  const date = new Date(Date.UTC(year, month1based, 0));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export const RESULTS_PERIOD_PRESETS = ['all', 'this_month', 'last_month', 'last_30_days', 'custom'] as const;
export type ResultsPeriodPreset = (typeof RESULTS_PERIOD_PRESETS)[number];

export type ResolvedResultsPeriod = {
  preset: ResultsPeriodPreset;
  /** Inclusive Madrid calendar-date bounds, for display — mirrors
   * lib/results.ts's ResultsPeriod shape. null/null = unbounded ('all'). */
  start: string | null;
  end: string | null;
  /** UTC instant bounds for SQL: start inclusive, end EXCLUSIVE. Both null
   * = unbounded. */
  queryStart: Date | null;
  queryEndExclusive: Date | null;
};

/** Resolves a preset (or a custom Madrid-calendar-date range) into concrete
 * bounds, anchored to Madrid "today" rather than the caller's/browser's UTC
 * clock. */
export function resolveResultsPeriod(
  preset: ResultsPeriodPreset,
  custom?: { start: string; end: string },
  now: Date = new Date(),
): ResolvedResultsPeriod {
  if (preset === 'all') return { preset, start: null, end: null, queryStart: null, queryEndExclusive: null };

  if (preset === 'custom') {
    if (!custom?.start || !custom?.end) {
      return { preset, start: null, end: null, queryStart: null, queryEndExclusive: null };
    }
    return {
      preset,
      start: custom.start,
      end: custom.end,
      queryStart: startOfMadridDayUtc(custom.start),
      queryEndExclusive: startOfMadridDayUtc(addDays(custom.end, 1)),
    };
  }

  const today = madridDateString(now);
  const [yearStr, monthStr] = today.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-based

  if (preset === 'this_month') {
    const start = `${year}-${pad2(month)}-01`;
    const end = lastDayOfMonth(year, month);
    return { preset, start, end, queryStart: startOfMadridDayUtc(start), queryEndExclusive: startOfMadridDayUtc(addDays(end, 1)) };
  }

  if (preset === 'last_month') {
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const start = `${prevYear}-${pad2(prevMonth)}-01`;
    const end = lastDayOfMonth(prevYear, prevMonth);
    return { preset, start, end, queryStart: startOfMadridDayUtc(start), queryEndExclusive: startOfMadridDayUtc(addDays(end, 1)) };
  }

  // last_30_days — inclusive of today, 30 days wide.
  const start = addDays(today, -29);
  return {
    preset,
    start,
    end: today,
    queryStart: startOfMadridDayUtc(start),
    queryEndExclusive: startOfMadridDayUtc(addDays(today, 1)),
  };
}

/** [start, now) as UTC instants for a trailing N-day Madrid-anchored window
 * — used by Home's "recently" widgets (e.g. value generated in the last 7
 * days), which use event-time semantics, not the cohort period model above. */
export function trailingDaysWindow(days: number, now: Date = new Date()): { start: Date; end: Date } {
  const today = madridDateString(now);
  const start = addDays(today, -(days - 1));
  return { start: startOfMadridDayUtc(start), end: now };
}

/** Same bucket-size heuristic as lib/results.ts's resolveTrendGranularity,
 * duplicated (not shared) deliberately: it's a chart-readability heuristic,
 * not funnel/business logic — the dedup-sensitive rules live once in
 * lib/results-domain.ts. */
export function resolveResultsTrendGranularity(preset: ResultsPeriodPreset, period: { start: string | null; end: string | null }): TrendGranularity {
  if (preset === 'this_month' || preset === 'last_month' || preset === 'last_30_days') return 'day';
  if (preset === 'custom' && period.start && period.end) {
    const days = (Date.parse(`${period.end}T00:00:00.000Z`) - Date.parse(`${period.start}T00:00:00.000Z`)) / 86_400_000;
    if (days <= 62) return 'day';
    if (days <= 365) return 'week';
    return 'month';
  }
  return 'month';
}

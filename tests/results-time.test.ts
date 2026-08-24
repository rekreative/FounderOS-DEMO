import { describe, it, expect } from 'vitest';
import {
  madridDateString,
  resolveResultsPeriod,
  resolveResultsTrendGranularity,
  startOfMadridDayUtc,
  trailingDaysWindow,
} from '@/lib/server/results-time';

// Pure functions, no DB — the Europe/Madrid boundary math Results V1 needed
// (see the approved decision to move date-boundary calculations off naive
// UTC). CEST (summer, UTC+2) and CET (winter, UTC+1) are both exercised
// since Madrid's offset changes with DST.

describe('madridDateString', () => {
  it('returns the Madrid calendar date for a UTC instant (CEST, UTC+2)', () => {
    // 2026-07-14T22:00:00Z is exactly 2026-07-15T00:00:00 in Madrid (summer).
    expect(madridDateString(new Date('2026-07-14T21:59:00.000Z'))).toBe('2026-07-14');
    expect(madridDateString(new Date('2026-07-14T22:00:00.000Z'))).toBe('2026-07-15');
  });

  it('returns the Madrid calendar date for a UTC instant (CET, UTC+1)', () => {
    // 2026-01-14T23:00:00Z is exactly 2026-01-15T00:00:00 in Madrid (winter).
    expect(madridDateString(new Date('2026-01-14T22:59:00.000Z'))).toBe('2026-01-14');
    expect(madridDateString(new Date('2026-01-14T23:00:00.000Z'))).toBe('2026-01-15');
  });
});

describe('startOfMadridDayUtc — the Madrid midnight boundary', () => {
  it('resolves Madrid local midnight to the correct UTC instant in summer (CEST, UTC+2)', () => {
    expect(startOfMadridDayUtc('2026-07-15').toISOString()).toBe('2026-07-14T22:00:00.000Z');
  });

  it('resolves Madrid local midnight to the correct UTC instant in winter (CET, UTC+1)', () => {
    expect(startOfMadridDayUtc('2026-01-15').toISOString()).toBe('2026-01-14T23:00:00.000Z');
  });

  it('a lead timestamped just before the Madrid midnight boundary belongs to the earlier Madrid day', () => {
    const justBefore = new Date('2026-07-14T21:59:59.000Z');
    expect(justBefore.getTime()).toBeLessThan(startOfMadridDayUtc('2026-07-15').getTime());
  });

  it('a lead timestamped just after the Madrid midnight boundary belongs to the later Madrid day', () => {
    const justAfter = new Date('2026-07-14T22:00:01.000Z');
    expect(justAfter.getTime()).toBeGreaterThanOrEqual(startOfMadridDayUtc('2026-07-15').getTime());
  });
});

describe('resolveResultsPeriod', () => {
  // 2026-08-19T10:00:00Z = 2026-08-19T12:00:00 Madrid (CEST) — safely
  // mid-day, no boundary ambiguity for the "today" presets below.
  const now = new Date('2026-08-19T10:00:00.000Z');

  it('all is unbounded', () => {
    const period = resolveResultsPeriod('all', undefined, now);
    expect(period).toMatchObject({ start: null, end: null, queryStart: null, queryEndExclusive: null });
  });

  it('this_month spans the full Madrid calendar month, converted to UTC instants', () => {
    const period = resolveResultsPeriod('this_month', undefined, now);
    expect(period.start).toBe('2026-08-01');
    expect(period.end).toBe('2026-08-31');
    expect(period.queryStart?.toISOString()).toBe('2026-07-31T22:00:00.000Z');
    expect(period.queryEndExclusive?.toISOString()).toBe('2026-08-31T22:00:00.000Z');
  });

  it('last_month spans the full previous Madrid calendar month', () => {
    const period = resolveResultsPeriod('last_month', undefined, now);
    expect(period.start).toBe('2026-07-01');
    expect(period.end).toBe('2026-07-31');
    expect(period.queryStart?.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(period.queryEndExclusive?.toISOString()).toBe('2026-07-31T22:00:00.000Z');
  });

  it('last_month rolls across a year boundary (winter, CET)', () => {
    const jan = new Date('2026-01-15T10:00:00.000Z');
    const period = resolveResultsPeriod('last_month', undefined, jan);
    expect(period.start).toBe('2025-12-01');
    expect(period.end).toBe('2025-12-31');
  });

  it('last_30_days is inclusive of Madrid "today" and 30 days wide', () => {
    const period = resolveResultsPeriod('last_30_days', undefined, now);
    expect(period.start).toBe('2026-07-21');
    expect(period.end).toBe('2026-08-19');
    expect(period.queryEndExclusive?.toISOString()).toBe('2026-08-19T22:00:00.000Z');
  });

  it('custom uses the given Madrid-calendar-date range, end bound exclusive of the following day', () => {
    const period = resolveResultsPeriod('custom', { start: '2026-02-01', end: '2026-02-14' }, now);
    expect(period.start).toBe('2026-02-01');
    expect(period.end).toBe('2026-02-14');
    // Winter (CET, UTC+1) at both ends.
    expect(period.queryStart?.toISOString()).toBe('2026-01-31T23:00:00.000Z');
    expect(period.queryEndExclusive?.toISOString()).toBe('2026-02-14T23:00:00.000Z');
  });

  it('custom with a missing bound resolves to unbounded, not a crash', () => {
    const period = resolveResultsPeriod('custom', undefined, now);
    expect(period).toMatchObject({ start: null, end: null, queryStart: null, queryEndExclusive: null });
  });
});

describe('trailingDaysWindow', () => {
  it('spans exactly N Madrid-anchored days ending at `now`', () => {
    const now = new Date('2026-08-19T10:00:00.000Z');
    const window = trailingDaysWindow(7, now);
    expect(window.end).toBe(now);
    // 7-day window inclusive of today (2026-08-19) starts 2026-08-13.
    expect(window.start.toISOString()).toBe(startOfMadridDayUtc('2026-08-13').toISOString());
  });
});

describe('resolveResultsTrendGranularity', () => {
  it('groups bounded short presets by day', () => {
    expect(resolveResultsTrendGranularity('this_month', { start: '2026-08-01', end: '2026-08-31' })).toBe('day');
  });

  it('groups the unbounded "all" preset by month', () => {
    expect(resolveResultsTrendGranularity('all', { start: null, end: null })).toBe('month');
  });

  it('picks week/month granularity for wider custom ranges', () => {
    expect(resolveResultsTrendGranularity('custom', { start: '2026-01-01', end: '2026-06-01' })).toBe('week');
    expect(resolveResultsTrendGranularity('custom', { start: '2024-01-01', end: '2026-01-01' })).toBe('month');
  });
});

import { describe, it, expect } from 'vitest';
import {
  aggregateResultsTotals,
  buildClientComparison,
  buildFunnelStages,
  buildLeadFunnel,
  computeCACPublicitario,
  computeClientResults,
  computeCPLCrm,
  computeROAS,
  filterLeadsByPeriod,
  filterRevenueRecordsByPeriod,
  formatEUR,
  formatRate,
  formatRoas,
  formatTrendBucketLabel,
  getStoredPeriodPreference,
  groupLeadsByPeriod,
  groupRevenueByPeriod,
  hasDemoCampaigns,
  hasDemoRevenueRecords,
  includesDemoData,
  isDuplicateRevenueRecord,
  isWithinPeriod,
  qualificationRate,
  bookingRate,
  attendanceRate,
  closeRate,
  resolveAdSpend,
  resolvePeriod,
  resolveTrendGranularity,
  setStoredPeriodPreference,
  sumAttributedRevenue,
  sumFunnelCounts,
  type RevenueRecord,
} from '@/lib/results';
import type { Lead, LeadEvent } from '@/lib/leads';
import type { MetaCampaign } from '@/lib/meta-ads';

// This suite runs under vitest's `node` environment (no window/localStorage) —
// same rationale as tests/automations.test.ts / tests/integration-connections.test.ts.
// Only pure functions are exercised here; RevenueRecord CRUD against
// localStorage needs a browser and is exercised by manual verification.

function makeLead(overrides: Partial<Lead> & Pick<Lead, 'id' | 'clientId' | 'stage' | 'createdAt'>): Lead {
  return {
    name: 'Test Lead',
    email: null,
    phone: null,
    whatsapp: null,
    source: 'Meta Ads',
    campaign: null,
    adCreative: null,
    form: null,
    lastActivityAt: overrides.createdAt,
    aiAnalysis: null,
    qualificationAnswers: null,
    appointmentDate: null,
    conversionValue: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<LeadEvent> & Pick<LeadEvent, 'leadId' | 'type'>): LeadEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    source: 'system',
    occurredAt: '2026-06-01T00:00:00.000Z',
    summary: 'test event',
    details: null,
    ...overrides,
  };
}

function makeRevenueRecord(overrides: Partial<RevenueRecord> & Pick<RevenueRecord, 'clientId' | 'amount' | 'occurredAt'>): RevenueRecord {
  return {
    id: `revenue-${Math.random().toString(36).slice(2, 8)}`,
    source: 'manual',
    externalRef: null,
    notes: null,
    createdAt: overrides.occurredAt,
    updatedAt: overrides.occurredAt,
    dataSource: 'manual',
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<MetaCampaign> & Pick<MetaCampaign, 'clientId' | 'spend'>): MetaCampaign {
  return {
    id: `campaign-${Math.random().toString(36).slice(2, 8)}`,
    externalCampaignId: null,
    name: 'Test campaign',
    status: 'active',
    objective: 'leads',
    budgetType: 'daily',
    dailyBudget: null,
    lifetimeBudget: null,
    impressions: 0,
    reach: 0,
    clicks: 0,
    leads: 0,
    startDate: '2026-01-01',
    endDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    dataSource: 'demo',
    ...overrides,
  };
}

// ── Period date boundaries ──────────────────────────────────────────────────

describe('resolvePeriod', () => {
  const now = new Date('2026-08-19T12:00:00.000Z');

  it('all is unbounded', () => {
    expect(resolvePeriod('all', undefined, now)).toEqual({ start: null, end: null });
  });

  it('this_month spans the full calendar month', () => {
    expect(resolvePeriod('this_month', undefined, now)).toEqual({ start: '2026-08-01', end: '2026-08-31' });
  });

  it('last_month spans the full previous calendar month', () => {
    expect(resolvePeriod('last_month', undefined, now)).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('last_month rolls across a year boundary', () => {
    const jan = new Date('2026-01-15T00:00:00.000Z');
    expect(resolvePeriod('last_month', undefined, jan)).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('last_30_days is inclusive of today and 30 days wide', () => {
    expect(resolvePeriod('last_30_days', undefined, now)).toEqual({ start: '2026-07-21', end: '2026-08-19' });
  });

  it('custom uses the given range verbatim', () => {
    expect(resolvePeriod('custom', { start: '2026-02-01', end: '2026-02-14' }, now)).toEqual({
      start: '2026-02-01',
      end: '2026-02-14',
    });
  });
});

describe('isWithinPeriod', () => {
  const period = { start: '2026-08-01', end: '2026-08-31' };

  it('includes the start boundary', () => {
    expect(isWithinPeriod('2026-08-01T23:59:00.000Z', period)).toBe(true);
  });

  it('includes the end boundary', () => {
    expect(isWithinPeriod('2026-08-31T00:00:01.000Z', period)).toBe(true);
  });

  it('excludes the day before start', () => {
    expect(isWithinPeriod('2026-07-31T23:59:59.000Z', period)).toBe(false);
  });

  it('excludes the day after end', () => {
    expect(isWithinPeriod('2026-09-01T00:00:00.000Z', period)).toBe(false);
  });

  it('unbounded (all) period includes everything', () => {
    expect(isWithinPeriod('2019-01-01T00:00:00.000Z', { start: null, end: null })).toBe(true);
  });
});

describe('filterLeadsByPeriod / filterRevenueRecordsByPeriod', () => {
  const period = { start: '2026-08-01', end: '2026-08-31' };

  it('filters leads by createdAt', () => {
    const leads = [
      makeLead({ id: 'l1', clientId: 'c1', stage: 'new', createdAt: '2026-08-10T00:00:00.000Z' }),
      makeLead({ id: 'l2', clientId: 'c1', stage: 'new', createdAt: '2026-07-10T00:00:00.000Z' }),
    ];
    expect(filterLeadsByPeriod(leads, period).map((l) => l.id)).toEqual(['l1']);
  });

  it('filters revenue records by occurredAt, not createdAt', () => {
    const records = [
      makeRevenueRecord({ clientId: 'c1', amount: 100, occurredAt: '2026-08-15T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z' }),
      makeRevenueRecord({ clientId: 'c1', amount: 200, occurredAt: '2026-07-15T00:00:00.000Z' }),
    ];
    expect(filterRevenueRecordsByPeriod(records, period).map((r) => r.amount)).toEqual([100]);
  });
});

// ── Revenue aggregation ──────────────────────────────────────────────────────

describe('sumAttributedRevenue', () => {
  it('sums amounts across records', () => {
    const records = [
      makeRevenueRecord({ clientId: 'c1', amount: 1000, occurredAt: '2026-08-01T00:00:00.000Z' }),
      makeRevenueRecord({ clientId: 'c1', amount: 500, occurredAt: '2026-08-02T00:00:00.000Z' }),
    ];
    expect(sumAttributedRevenue(records)).toBe(1500);
  });

  it('is zero for no records', () => {
    expect(sumAttributedRevenue([])).toBe(0);
  });
});

// ── Client isolation ─────────────────────────────────────────────────────────

describe('client isolation', () => {
  it('a funnel built from one client’s cohort never counts another client’s leads', () => {
    const leads = [
      makeLead({ id: 'a1', clientId: 'client-a', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z' }),
      makeLead({ id: 'b1', clientId: 'client-b', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z' }),
      makeLead({ id: 'b2', clientId: 'client-b', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z' }),
    ];
    const cohortA = leads.filter((l) => l.clientId === 'client-a');
    const counts = buildLeadFunnel(cohortA, []);
    expect(counts.leads).toBe(1);
    expect(counts.converted).toBe(1);
  });

  it('revenue aggregation for one client never includes another client’s records', () => {
    const records = [
      makeRevenueRecord({ clientId: 'client-a', amount: 1000, occurredAt: '2026-08-01T00:00:00.000Z' }),
      makeRevenueRecord({ clientId: 'client-b', amount: 9000, occurredAt: '2026-08-01T00:00:00.000Z' }),
    ];
    const forA = records.filter((r) => r.clientId === 'client-a');
    expect(sumAttributedRevenue(forA)).toBe(1000);
  });
});

// ── Funnel derivation: distinct-lead counting, dedup, stage semantics ───────

describe('buildLeadFunnel', () => {
  it('counts a lead once per stage even with duplicate qualifying events (reschedule)', () => {
    const lead = makeLead({ id: 'l1', clientId: 'c1', stage: 'appointment', createdAt: '2026-08-01T00:00:00.000Z' });
    const events: LeadEvent[] = [
      makeEvent({ leadId: 'l1', type: 'appointment_booked' }),
      makeEvent({ leadId: 'l1', type: 'appointment_booked' }), // reschedule — must not double count
    ];
    const counts = buildLeadFunnel([lead], events);
    expect(counts.appointments).toBe(1);
  });

  it('qualified: current stage at or beyond qualified counts directly', () => {
    const lead = makeLead({ id: 'l1', clientId: 'c1', stage: 'qualified', createdAt: '2026-08-01T00:00:00.000Z' });
    expect(buildLeadFunnel([lead], []).qualified).toBe(1);
  });

  it('qualified: reached via stage_changed event even though current stage regressed to disqualified', () => {
    // Mirrors the possibility of a lead being qualified then later disqualified —
    // the historical event log must still count it as having reached qualified.
    const lead = makeLead({ id: 'l1', clientId: 'c1', stage: 'disqualified', createdAt: '2026-08-01T00:00:00.000Z' });
    const events = [makeEvent({ leadId: 'l1', type: 'stage_changed', details: { from: 'contacted', to: 'qualified' } })];
    const counts = buildLeadFunnel([lead], events);
    expect(counts.qualified).toBe(1);
    expect(counts.converted).toBe(0);
  });

  it('mirrors the seeded lib/leads.ts inconsistency: converted event with no intermediate stage_changed events still counts at every earlier stage', () => {
    // Same shape as lead-demo-5 in lib/leads.ts: current stage 'new', but a
    // 'converted' LeadEvent on record.
    const lead = makeLead({ id: 'l1', clientId: 'c1', stage: 'new', createdAt: '2026-08-01T00:00:00.000Z' });
    const events = [makeEvent({ leadId: 'l1', type: 'converted', details: { value: 4200 } })];
    const counts = buildLeadFunnel([lead], events);
    expect(counts.qualified).toBe(1);
    expect(counts.appointments).toBe(1);
    expect(counts.converted).toBe(1);
  });

  it('appointment_booked: citas counted, but not attended', () => {
    const lead = makeLead({ id: 'l1', clientId: 'c1', stage: 'appointment', createdAt: '2026-08-01T00:00:00.000Z' });
    const events = [makeEvent({ leadId: 'l1', type: 'appointment_booked' })];
    const counts = buildLeadFunnel([lead], events);
    expect(counts.appointments).toBe(1);
    expect(counts.attended).toBe(0);
  });

  it('appointment_completed: attended is event-only, never inferred from current stage alone', () => {
    const lead = makeLead({ id: 'l1', clientId: 'c1', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z' });
    // No appointment_completed event at all — a converted lead did not
    // provably attend a live appointment (e.g. self-serve conversion).
    const counts = buildLeadFunnel([lead], []);
    expect(counts.attended).toBe(0);
  });

  it('appointment_completed event marks attended, and implies citas too', () => {
    const lead = makeLead({ id: 'l1', clientId: 'c1', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z' });
    const events = [makeEvent({ leadId: 'l1', type: 'appointment_completed' })];
    const counts = buildLeadFunnel([lead], events);
    expect(counts.attended).toBe(1);
    expect(counts.appointments).toBe(1);
  });

  it('converted: current stage converted counts directly', () => {
    const lead = makeLead({ id: 'l1', clientId: 'c1', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z' });
    expect(buildLeadFunnel([lead], []).converted).toBe(1);
  });

  it('a fresh lead with no events and stage new counts only at the leads stage', () => {
    const lead = makeLead({ id: 'l1', clientId: 'c1', stage: 'new', createdAt: '2026-08-01T00:00:00.000Z' });
    const counts = buildLeadFunnel([lead], []);
    expect(counts).toEqual({ leads: 1, qualified: 0, appointments: 0, attended: 0, converted: 0 });
  });

  it('handles an empty cohort without crashing (all-zero funnel)', () => {
    expect(buildLeadFunnel([], [])).toEqual({ leads: 0, qualified: 0, appointments: 0, attended: 0, converted: 0 });
  });
});

describe('buildFunnelStages', () => {
  it('computes stage-to-stage rates from the previous row', () => {
    const stages = buildFunnelStages({ leads: 100, qualified: 40, appointments: 20, attended: 15, converted: 5 });
    expect(stages.map((s) => s.rateFromPrevious)).toEqual([null, 0.4, 0.5, 0.75, 1 / 3]);
  });

  it('rate is null (not a divide-by-zero) when the previous stage is empty', () => {
    const stages = buildFunnelStages({ leads: 0, qualified: 0, appointments: 0, attended: 0, converted: 0 });
    expect(stages.every((s) => s.rateFromPrevious === null)).toBe(true);
  });
});

// ── Ad spend availability by period ─────────────────────────────────────────

describe('resolveAdSpend', () => {
  const campaigns = [makeCampaign({ clientId: 'c1', spend: 1000 }), makeCampaign({ clientId: 'c1', spend: 500 })];

  it('sums lifetime campaign spend when period is all-time', () => {
    expect(resolveAdSpend(campaigns, 'all')).toBe(1500);
  });

  it('is unavailable (null) for any non-all-time preset', () => {
    expect(resolveAdSpend(campaigns, 'this_month')).toBeNull();
    expect(resolveAdSpend(campaigns, 'last_month')).toBeNull();
    expect(resolveAdSpend(campaigns, 'last_30_days')).toBeNull();
    expect(resolveAdSpend(campaigns, 'custom')).toBeNull();
  });
});

describe('non-all-time KPIs are unavailable, not estimated', () => {
  it('CAC, CPL and ROAS all fall back to null when adSpend is null', () => {
    expect(computeCACPublicitario(null, 5)).toBeNull();
    expect(computeCPLCrm(null, 10)).toBeNull();
    expect(computeROAS(2000, null)).toBeNull();
  });
});

// ── CAC / ROAS / CPL / rates — zero denominators ────────────────────────────

describe('computeCACPublicitario', () => {
  it('divides ad spend by converted CRM leads', () => {
    expect(computeCACPublicitario(6500, 1)).toBe(6500);
  });
  it('is null when there are zero conversions', () => {
    expect(computeCACPublicitario(6500, 0)).toBeNull();
  });
});

describe('computeROAS', () => {
  it('divides attributed revenue by ad spend', () => {
    expect(computeROAS(4000, 6500)).toBeCloseTo(4000 / 6500);
  });
  it('is null when spend is zero', () => {
    expect(computeROAS(4000, 0)).toBeNull();
  });
  it('is null when attributed revenue is zero (treated as "not entered", not "confirmed zero")', () => {
    expect(computeROAS(0, 6500)).toBeNull();
  });
});

describe('computeCPLCrm', () => {
  it('divides ad spend by CRM leads', () => {
    expect(computeCPLCrm(1000, 20)).toBe(50);
  });
  it('is null when there are zero CRM leads', () => {
    expect(computeCPLCrm(1000, 0)).toBeNull();
  });
});

describe('funnel rate helpers', () => {
  const zeroCounts = { leads: 0, qualified: 0, appointments: 0, attended: 0, converted: 0 };

  it('are all null on an all-zero funnel', () => {
    expect(qualificationRate(zeroCounts)).toBeNull();
    expect(bookingRate(zeroCounts)).toBeNull();
    expect(attendanceRate(zeroCounts)).toBeNull();
    expect(closeRate(zeroCounts)).toBeNull();
  });

  it('compute correctly on a populated funnel', () => {
    const counts = { leads: 10, qualified: 5, appointments: 4, attended: 2, converted: 1 };
    expect(qualificationRate(counts)).toBe(0.5);
    expect(bookingRate(counts)).toBe(0.8);
    expect(attendanceRate(counts)).toBe(0.5);
    expect(closeRate(counts)).toBe(0.1);
  });
});

// ── Aggregate ratios use aggregate totals, never averaged per-client ───────

describe('aggregateResultsTotals', () => {
  it('derives ROAS/CAC from summed totals, not from averaging each client’s own ratio', () => {
    // Client A: small spend, huge ROAS on its own (10x). Client B: big spend,
    // weak ROAS on its own (0.5x). A naive average of (10 + 0.5) / 2 = 5.25x
    // would be wrong and would over-weight the small client.
    const perClient = [
      { adSpend: 100, crmLeads: 5, converted: 1, attributedRevenue: 1000 }, // 10x alone
      { adSpend: 10000, crmLeads: 50, converted: 10, attributedRevenue: 5000 }, // 0.5x alone
    ];
    const totals = aggregateResultsTotals(perClient);
    expect(totals.adSpend).toBe(10100);
    expect(totals.attributedRevenue).toBe(6000);
    expect(totals.converted).toBe(11);
    expect(totals.roas).toBeCloseTo(6000 / 10100);
    expect(totals.cac).toBeCloseTo(10100 / 11);
    // Explicitly not the naive per-client average:
    expect(totals.roas).not.toBeCloseTo((10 + 0.5) / 2, 1);
  });

  it('adSpend is unavailable (null) for the aggregate whenever any client’s spend is unavailable', () => {
    const perClient = [
      { adSpend: 1000, crmLeads: 5, converted: 1, attributedRevenue: 500 },
      { adSpend: null, crmLeads: 5, converted: 1, attributedRevenue: 500 },
    ];
    const totals = aggregateResultsTotals(perClient);
    expect(totals.adSpend).toBeNull();
    expect(totals.roas).toBeNull();
    expect(totals.cac).toBeNull();
    // Leads/conversions/revenue remain available even when spend isn't.
    expect(totals.crmLeads).toBe(10);
    expect(totals.attributedRevenue).toBe(1000);
  });
});

// ── externalRef dedup preparation ───────────────────────────────────────────

describe('isDuplicateRevenueRecord', () => {
  it('is never a duplicate when externalRef is null (manual entries)', () => {
    const records = [makeRevenueRecord({ clientId: 'c1', amount: 100, occurredAt: '2026-08-01T00:00:00.000Z', externalRef: null })];
    expect(isDuplicateRevenueRecord(records, 'manual', null)).toBe(false);
  });

  it('is a duplicate when source and externalRef both match an existing record', () => {
    const records = [
      makeRevenueRecord({ clientId: 'c1', amount: 100, occurredAt: '2026-08-01T00:00:00.000Z', source: 'stripe', externalRef: 'ch_123' }),
    ];
    expect(isDuplicateRevenueRecord(records, 'stripe', 'ch_123')).toBe(true);
  });

  it('is not a duplicate when externalRef matches but source differs (source+externalRef uniqueness, not externalRef alone)', () => {
    const records = [
      makeRevenueRecord({ clientId: 'c1', amount: 100, occurredAt: '2026-08-01T00:00:00.000Z', source: 'stripe', externalRef: 'txn_1' }),
    ];
    expect(isDuplicateRevenueRecord(records, 'paypal', 'txn_1')).toBe(false);
  });
});

// ── Formatting ───────────────────────────────────────────────────────────────

describe('formatting helpers', () => {
  it('formatEUR rounds to the nearest whole unit and appends the euro sign', () => {
    expect(formatEUR(500.4)).toBe('500 €');
    expect(formatEUR(500.6)).toBe('501 €');
  });

  it('formatRoas renders a comma-decimal "x" suffix, and "—" for null', () => {
    expect(formatRoas(3.2)).toBe('3,2x');
    expect(formatRoas(null)).toBe('—');
  });

  it('formatRate renders a rounded percentage, and "—" for null', () => {
    expect(formatRate(0.4)).toBe('40%');
    expect(formatRate(null)).toBe('—');
  });
});

// ── Trend granularity ────────────────────────────────────────────────────────

describe('resolveTrendGranularity', () => {
  it('groups bounded short presets by day', () => {
    expect(resolveTrendGranularity('this_month', { start: '2026-08-01', end: '2026-08-31' })).toBe('day');
    expect(resolveTrendGranularity('last_month', { start: '2026-07-01', end: '2026-07-31' })).toBe('day');
    expect(resolveTrendGranularity('last_30_days', { start: '2026-07-21', end: '2026-08-19' })).toBe('day');
  });

  it('groups the unbounded "all" preset by month', () => {
    expect(resolveTrendGranularity('all', { start: null, end: null })).toBe('month');
  });

  it('picks granularity from a custom range width', () => {
    expect(resolveTrendGranularity('custom', { start: '2026-08-01', end: '2026-08-15' })).toBe('day'); // 14 days
    expect(resolveTrendGranularity('custom', { start: '2026-01-01', end: '2026-06-01' })).toBe('week'); // ~151 days
    expect(resolveTrendGranularity('custom', { start: '2024-01-01', end: '2026-01-01' })).toBe('month'); // ~730 days
  });

  it('falls back to month for an incomplete custom range', () => {
    expect(resolveTrendGranularity('custom', { start: null, end: null })).toBe('month');
  });
});

describe('groupLeadsByPeriod', () => {
  it('buckets by exact day', () => {
    const leads = [
      makeLead({ id: 'l1', clientId: 'c1', stage: 'new', createdAt: '2026-08-10T09:00:00.000Z' }),
      makeLead({ id: 'l2', clientId: 'c1', stage: 'new', createdAt: '2026-08-10T18:00:00.000Z' }),
      makeLead({ id: 'l3', clientId: 'c1', stage: 'new', createdAt: '2026-08-11T09:00:00.000Z' }),
    ];
    expect(groupLeadsByPeriod(leads, 'day')).toEqual([
      { bucket: '2026-08-10', value: 2 },
      { bucket: '2026-08-11', value: 1 },
    ]);
  });

  it('buckets by the Monday of the ISO week', () => {
    const leads = [
      makeLead({ id: 'l1', clientId: 'c1', stage: 'new', createdAt: '2026-08-17T10:00:00.000Z' }), // Monday
      makeLead({ id: 'l2', clientId: 'c1', stage: 'new', createdAt: '2026-08-19T10:00:00.000Z' }), // Wednesday, same week
      makeLead({ id: 'l3', clientId: 'c1', stage: 'new', createdAt: '2026-08-24T10:00:00.000Z' }), // next Monday
    ];
    expect(groupLeadsByPeriod(leads, 'week')).toEqual([
      { bucket: '2026-08-17', value: 2 },
      { bucket: '2026-08-24', value: 1 },
    ]);
  });

  it('buckets by calendar month', () => {
    const leads = [
      makeLead({ id: 'l1', clientId: 'c1', stage: 'new', createdAt: '2026-08-01T00:00:00.000Z' }),
      makeLead({ id: 'l2', clientId: 'c1', stage: 'new', createdAt: '2026-08-30T00:00:00.000Z' }),
      makeLead({ id: 'l3', clientId: 'c1', stage: 'new', createdAt: '2026-09-01T00:00:00.000Z' }),
    ];
    expect(groupLeadsByPeriod(leads, 'month')).toEqual([
      { bucket: '2026-08', value: 2 },
      { bucket: '2026-09', value: 1 },
    ]);
  });

  it('returns an empty series for no leads, never throwing', () => {
    expect(groupLeadsByPeriod([], 'day')).toEqual([]);
  });
});

describe('groupRevenueByPeriod', () => {
  it('sums amounts per bucket, from RevenueRecord.amount only', () => {
    const records = [
      makeRevenueRecord({ clientId: 'c1', amount: 100, occurredAt: '2026-08-10T00:00:00.000Z' }),
      makeRevenueRecord({ clientId: 'c1', amount: 250, occurredAt: '2026-08-10T12:00:00.000Z' }),
      makeRevenueRecord({ clientId: 'c1', amount: 400, occurredAt: '2026-08-11T00:00:00.000Z' }),
    ];
    expect(groupRevenueByPeriod(records, 'day')).toEqual([
      { bucket: '2026-08-10', value: 350 },
      { bucket: '2026-08-11', value: 400 },
    ]);
  });
});

describe('formatTrendBucketLabel', () => {
  it('renders a day bucket as day + short month', () => {
    expect(formatTrendBucketLabel('2026-08-19', 'day')).toMatch(/19/);
  });

  it('renders a week bucket prefixed with "sem."', () => {
    expect(formatTrendBucketLabel('2026-08-17', 'week')).toMatch(/^sem\./);
  });

  it('renders a month bucket as short month + 2-digit year', () => {
    const label = formatTrendBucketLabel('2026-08', 'month');
    expect(label).toMatch(/26/);
  });
});

// ── Client-level orchestration (single source for both Results surfaces) ───

describe('computeClientResults', () => {
  it('filters every input by clientId internally — no leakage across clients', () => {
    const leads = [
      makeLead({ id: 'a1', clientId: 'client-a', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z' }),
      makeLead({ id: 'b1', clientId: 'client-b', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z' }),
    ];
    const revenue = [
      makeRevenueRecord({ clientId: 'client-a', amount: 500, occurredAt: '2026-08-01T00:00:00.000Z' }),
      makeRevenueRecord({ clientId: 'client-b', amount: 9000, occurredAt: '2026-08-01T00:00:00.000Z' }),
    ];
    const campaigns = [makeCampaign({ clientId: 'client-a', spend: 100 }), makeCampaign({ clientId: 'client-b', spend: 5000 })];

    const resultsA = computeClientResults('client-a', leads, [], campaigns, revenue, { start: null, end: null }, 'all');
    expect(resultsA.counts.leads).toBe(1);
    expect(resultsA.attributedRevenue).toBe(500);
    expect(resultsA.adSpend).toBe(100);
  });

  it('exposes the same KPI numbers ResultsBoard and ClientResultsDashboard both read', () => {
    const leads = [makeLead({ id: 'l1', clientId: 'c1', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z' })];
    const campaigns = [makeCampaign({ clientId: 'c1', spend: 1000 })];
    const revenue = [makeRevenueRecord({ clientId: 'c1', amount: 2000, occurredAt: '2026-08-01T00:00:00.000Z' })];
    const results = computeClientResults('c1', leads, [], campaigns, revenue, { start: null, end: null }, 'all');
    expect(results.roas).toBeCloseTo(2);
    expect(results.cac).toBe(1000);
  });
});

describe('buildClientComparison', () => {
  it('sorts rows by attributed revenue, largest first', () => {
    const clients = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const perClient = [
      { clientId: 'a', adSpend: 100, counts: { leads: 5, qualified: 0, appointments: 0, attended: 0, converted: 1 }, attributedRevenue: 500, roas: 5, cac: 100 },
      { clientId: 'b', adSpend: 200, counts: { leads: 10, qualified: 0, appointments: 0, attended: 0, converted: 2 }, attributedRevenue: 5000, roas: 25, cac: 100 },
    ];
    const rows = buildClientComparison(clients, perClient);
    expect(rows.map((r) => r.clientId)).toEqual(['b', 'a']);
  });

  it('defaults to zero/null for a client with no computation available', () => {
    const rows = buildClientComparison([{ id: 'a', name: 'A' }], []);
    expect(rows).toEqual([{ clientId: 'a', clientName: 'A', adSpend: null, crmLeads: 0, converted: 0, attributedRevenue: 0, roas: null, cac: null }]);
  });
});

describe('sumFunnelCounts', () => {
  it('sums funnel counts field-wise across clients', () => {
    const counts = [
      { leads: 10, qualified: 4, appointments: 3, attended: 2, converted: 1 },
      { leads: 5, qualified: 2, appointments: 1, attended: 1, converted: 0 },
    ];
    expect(sumFunnelCounts(counts)).toEqual({ leads: 15, qualified: 6, appointments: 4, attended: 3, converted: 1 });
  });

  it('is all-zero for an empty list', () => {
    expect(sumFunnelCounts([])).toEqual({ leads: 0, qualified: 0, appointments: 0, attended: 0, converted: 0 });
  });
});

// ── Demo data detection ─────────────────────────────────────────────────────

describe('demo data detection', () => {
  it('hasDemoRevenueRecords is true only when a record is dataSource "demo"', () => {
    expect(hasDemoRevenueRecords([makeRevenueRecord({ clientId: 'c1', amount: 1, occurredAt: '2026-08-01T00:00:00.000Z', dataSource: 'demo' })])).toBe(true);
    expect(hasDemoRevenueRecords([makeRevenueRecord({ clientId: 'c1', amount: 1, occurredAt: '2026-08-01T00:00:00.000Z', dataSource: 'manual' })])).toBe(false);
  });

  it('hasDemoCampaigns is true only when a campaign is dataSource "demo"', () => {
    expect(hasDemoCampaigns([makeCampaign({ clientId: 'c1', spend: 1, dataSource: 'demo' })])).toBe(true);
    expect(hasDemoCampaigns([makeCampaign({ clientId: 'c1', spend: 1, dataSource: 'manual' })])).toBe(false);
  });

  it('never flags manual-only user-entered data as demo', () => {
    const revenueRecords = [makeRevenueRecord({ clientId: 'c1', amount: 1, occurredAt: '2026-08-01T00:00:00.000Z', dataSource: 'manual' })];
    const campaigns = [makeCampaign({ clientId: 'c1', spend: 1, dataSource: 'manual' })];
    expect(includesDemoData({ revenueRecords, campaigns })).toBe(false);
  });

  it('includesDemoData is true if either source has demo rows', () => {
    const revenueRecords = [makeRevenueRecord({ clientId: 'c1', amount: 1, occurredAt: '2026-08-01T00:00:00.000Z', dataSource: 'demo' })];
    expect(includesDemoData({ revenueRecords, campaigns: [] })).toBe(true);
  });
});

// ── Period preference persistence (SSR-safe fallback) ───────────────────────

describe('period preference persistence', () => {
  // This suite runs under vitest's `node` environment (no window/localStorage)
  // — same rationale noted at the top of this file. What IS testable here is
  // the SSR-safe fallback: no window means "all", never a throw.
  it('getStoredPeriodPreference falls back to "all" with no window', () => {
    expect(getStoredPeriodPreference()).toEqual({ preset: 'all', start: null, end: null });
  });

  it('setStoredPeriodPreference is a no-op with no window (never throws)', () => {
    expect(() => setStoredPeriodPreference({ preset: 'custom', start: '2026-01-01', end: '2026-01-31' })).not.toThrow();
  });
});

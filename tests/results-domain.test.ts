import { describe, it, expect } from 'vitest';
import { sumConvertedValue } from '@/lib/results-domain';
import type { Lead, LeadEvent } from '@/lib/leads';

// Pure-function unit tests for the new (Results V1) conversion-value
// aggregation — separate from tests/results.test.ts, which already covers
// every function that was merely relocated (unchanged) from lib/results.ts
// into lib/results-domain.ts.

function makeLead(overrides: Partial<Lead> & Pick<Lead, 'id' | 'clientId' | 'stage' | 'createdAt'>): Lead {
  return {
    scope: 'client',
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

describe('sumConvertedValue', () => {
  it('sums conversionValue over converted leads only', () => {
    const leads = [
      makeLead({ id: 'l1', clientId: 'c1', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z', conversionValue: 500 }),
      makeLead({ id: 'l2', clientId: 'c1', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z', conversionValue: 300 }),
      makeLead({ id: 'l3', clientId: 'c1', stage: 'qualified', createdAt: '2026-08-01T00:00:00.000Z', conversionValue: null }),
    ];
    const summary = sumConvertedValue(leads, []);
    expect(summary.total).toBe(800);
    expect(summary.average).toBe(400);
    expect(summary.count).toBe(2);
  });

  it('a converted lead with no recorded conversionValue is excluded, not treated as 0', () => {
    const leads = [
      makeLead({ id: 'l1', clientId: 'c1', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z', conversionValue: 1000 }),
      makeLead({ id: 'l2', clientId: 'c1', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z', conversionValue: null }),
    ];
    const summary = sumConvertedValue(leads, []);
    expect(summary.total).toBe(1000);
    expect(summary.average).toBe(1000); // averaged over the ONE lead with a value, not two
    expect(summary.count).toBe(1);
  });

  it('is null (never 0) when there are no converted leads with a value at all', () => {
    const leads = [makeLead({ id: 'l1', clientId: 'c1', stage: 'new', createdAt: '2026-08-01T00:00:00.000Z' })];
    const summary = sumConvertedValue(leads, []);
    expect(summary.total).toBeNull();
    expect(summary.average).toBeNull();
    expect(summary.count).toBe(0);
  });

  it('is null for an empty cohort', () => {
    expect(sumConvertedValue([], [])).toEqual({ total: null, average: null, count: 0 });
  });

  it('a lead reaching converted only via a converted EVENT (stage not yet reflecting it) still contributes its value', () => {
    const lead = makeLead({ id: 'l1', clientId: 'c1', stage: 'appointment', createdAt: '2026-08-01T00:00:00.000Z', conversionValue: 750 });
    const events = [makeEvent({ leadId: 'l1', type: 'converted' })];
    const summary = sumConvertedValue([lead], events);
    expect(summary.total).toBe(750);
    expect(summary.count).toBe(1);
  });

  it('a repeated converted event for the same lead still sums its value once (single lead, single conversionValue field)', () => {
    const lead = makeLead({ id: 'l1', clientId: 'c1', stage: 'converted', createdAt: '2026-08-01T00:00:00.000Z', conversionValue: 900 });
    const events = [makeEvent({ leadId: 'l1', type: 'converted' }), makeEvent({ leadId: 'l1', type: 'converted' })];
    const summary = sumConvertedValue([lead], events);
    expect(summary.total).toBe(900);
    expect(summary.count).toBe(1);
  });
});

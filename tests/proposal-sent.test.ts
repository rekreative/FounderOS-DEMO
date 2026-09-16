import { describe, expect, it } from 'vitest';
import { LeadStageSchema, CommercialEventBodySchema, ManualCommercialEventBodySchema } from '@/lib/server/schemas';
import { buildLeadFunnel, sumConvertedValue } from '@/lib/results-domain';
import type { Lead, LeadEvent } from '@/lib/leads';

describe('Proposal sent lifecycle', () => {
  it('accepts proposals through both existing commercial contracts', () => {
    expect(LeadStageSchema.parse('proposal_sent')).toBe('proposal_sent');
    expect(ManualCommercialEventBodySchema.parse({ type: 'proposal_sent' })).toEqual({ type: 'proposal_sent' });
    expect(CommercialEventBodySchema.safeParse({ type: 'proposal_sent', leadId: 'a', externalEventId: 'proposal-a' }).success).toBe(true);
    expect(CommercialEventBodySchema.safeParse({ type: 'proposal_sent', leadId: 'a' }).success).toBe(false);
  });

  it('counts a proposal once without inventing appointments or revenue', () => {
    const lead = { id: 'a', stage: 'proposal_sent', conversionValue: 300 } as Lead;
    const events = [{ leadId: 'a', type: 'proposal_sent' }, { leadId: 'a', type: 'proposal_sent' }] as LeadEvent[];
    expect(buildLeadFunnel([lead], events)).toMatchObject({ proposals: 1, appointments: 0, attended: 0, converted: 0 });
    expect(sumConvertedValue([lead], events).count).toBe(0);
  });

  it('preserves proposal history after conversion or rejection without inventing historical proposals', () => {
    const leads = [{ id: 'a', stage: 'converted' }, { id: 'b', stage: 'disqualified' }, { id: 'c', stage: 'converted' }] as Lead[];
    const events = [{ leadId: 'a', type: 'proposal_sent' }, { leadId: 'b', type: 'stage_changed', details: { to: 'proposal_sent' } }] as LeadEvent[];
    expect(buildLeadFunnel(leads, events)).toMatchObject({ proposals: 2, converted: 2 });
  });
});

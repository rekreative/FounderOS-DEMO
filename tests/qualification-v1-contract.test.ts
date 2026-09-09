import { describe, expect, it } from 'vitest';
import {
  CommercialEventBodySchema,
  LeadEventTypeSchema,
  ManualCommercialEventBodySchema,
  WhatsAppEventBodySchema,
} from '@/lib/server/schemas';

describe('Qualification V1 contracts', () => {
  it('accepts qualified as a semantic lead event', () => {
    expect(LeadEventTypeSchema.parse('qualified')).toBe('qualified');
  });

  it('prepares the existing Make commercial endpoint for qualified without caller-controlled stage', () => {
    expect(
      CommercialEventBodySchema.parse({
        type: 'qualified',
        leadId: 'lead-1',
        externalEventId: 'qualification-1',
        occurredAt: '2026-09-09T08:00:00.000Z',
      }),
    ).toMatchObject({ type: 'qualified', leadId: 'lead-1' });
    expect(
      CommercialEventBodySchema.safeParse({
        type: 'qualified',
        leadId: 'lead-1',
        externalEventId: 'qualification-1',
        stage: 'converted',
      }).success,
    ).toBe(false);
  });

  it('accepts the same qualified primitive for the manual UI', () => {
    expect(ManualCommercialEventBodySchema.parse({ type: 'qualified' })).toEqual({ type: 'qualified' });
  });

  it('keeps lead_replied tenant-aware and separate from commercial qualification', () => {
    expect(
      WhatsAppEventBodySchema.parse({
        type: 'lead_replied',
        whatsappNumber: '34600000000',
        phoneNumberId: '1215572848300862',
        externalEventId: 'wamid.reply',
        occurredAt: '2026-09-09T08:00:00.000Z',
      }),
    ).toMatchObject({ type: 'lead_replied' });
  });
});

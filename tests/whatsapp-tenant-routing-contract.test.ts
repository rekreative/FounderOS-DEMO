import { describe, expect, it } from 'vitest';
import {
  CreateWhatsAppBusinessNumberBodySchema,
  UpdateWhatsAppBusinessNumberBodySchema,
  WhatsAppEventBodySchema,
} from '@/lib/server/schemas';

describe('WhatsApp tenant routing API contract', () => {
  it('keeps outbound events addressed by leadId', () => {
    expect(
      WhatsAppEventBodySchema.parse({
        type: 'whatsapp_sent',
        leadId: 'lead-1',
        externalEventId: 'wamid.sent-1',
      }),
    ).toMatchObject({ type: 'whatsapp_sent', leadId: 'lead-1' });
  });

  it('requires destination identity and occurrence time for inbound replies', () => {
    expect(
      WhatsAppEventBodySchema.parse({
        type: 'lead_replied',
        whatsappNumber: '34612345678',
        phoneNumberId: '123456789012345',
        wabaId: '987654321098765',
        externalEventId: 'wamid.reply-1',
        occurredAt: '2026-09-03T08:00:00.000Z',
      }),
    ).toMatchObject({ type: 'lead_replied', phoneNumberId: '123456789012345' });

    expect(
      WhatsAppEventBodySchema.safeParse({
        type: 'lead_replied',
        whatsappNumber: '34612345678',
        externalEventId: 'wamid.reply-2',
      }).success,
    ).toBe(false);
  });

  it('never accepts caller-controlled ownership', () => {
    expect(
      WhatsAppEventBodySchema.safeParse({
        type: 'lead_replied',
        whatsappNumber: '34612345678',
        phoneNumberId: '123456789012345',
        externalEventId: 'wamid.reply-3',
        occurredAt: '2026-09-03T08:00:00.000Z',
        ownerScope: 'client',
        clientId: 'client-a',
      }).success,
    ).toBe(false);
  });

  it('enforces the mapping owner invariant at the API boundary', () => {
    expect(
      CreateWhatsAppBusinessNumberBodySchema.safeParse({
        ownerScope: 'internal',
        clientId: 'client-a',
        phoneNumberId: '123',
      }).success,
    ).toBe(false);
    expect(
      CreateWhatsAppBusinessNumberBodySchema.safeParse({
        ownerScope: 'client',
        phoneNumberId: '123',
      }).success,
    ).toBe(false);
  });

  it('keeps routing identity immutable when editing a mapping', () => {
    expect(UpdateWhatsAppBusinessNumberBodySchema.safeParse({ label: 'Principal' }).success).toBe(true);
    expect(UpdateWhatsAppBusinessNumberBodySchema.safeParse({ phoneNumberId: 'different' }).success).toBe(false);
    expect(UpdateWhatsAppBusinessNumberBodySchema.safeParse({ clientId: 'client-b' }).success).toBe(false);
  });
});

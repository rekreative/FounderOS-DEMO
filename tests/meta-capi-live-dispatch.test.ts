import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: false,
  prepare: vi.fn(),
  settle: vi.fn(),
  config: vi.fn(),
  build: vi.fn(),
  send: vi.fn(),
}));

vi.mock('@/lib/server/leads-repo', () => ({
  LeadNotFoundError: class LeadNotFoundError extends Error {},
  MetaCapiLeadValidationError: class MetaCapiLeadValidationError extends Error {},
  prepareMetaCapiLiveDelivery: mocks.prepare,
  settleMetaCapiLiveDelivery: mocks.settle,
}));

vi.mock('@/lib/server/meta-capi', () => ({
  MetaCapiConfigurationError: class MetaCapiConfigurationError extends Error {},
  MetaCapiPayloadValidationError: class MetaCapiPayloadValidationError extends Error {},
  isMetaCapiLiveEnabled: () => mocks.enabled,
  getMetaCapiConfiguration: mocks.config,
  buildMetaCapiLiveRequest: mocks.build,
  sendMetaCapiLiveRequest: mocks.send,
}));

import { dispatchMetaCapiLiveEvent } from '@/lib/server/meta-capi-live';

const occurrence = new Date('2026-09-17T12:00:00.000Z');
const delivery = {
  id: 'delivery-1', leadId: 'lead-1', eventKind: 'converted', metaEventName: 'Purchase',
  eventId: 'rekreos-live-lead-1-converted-payment-payment-1', sourceIdentity: 'payment:payment-1',
  deliveryMode: 'live', status: 'pending', attemptCount: 1, lastAttemptedAt: occurrence.toISOString(),
  acceptedAt: null, errorCode: null, eventOccurredAt: occurrence.toISOString(), createdAt: occurrence.toISOString(), updatedAt: occurrence.toISOString(),
} as const;

describe('Meta CAPI live dispatcher', () => {
  it('does nothing while the server-side live flag is disabled', async () => {
    mocks.enabled = false;
    await expect(dispatchMetaCapiLiveEvent({ leadId: 'lead-1', kind: 'qualified_lead', occurredAt: occurrence })).resolves.toEqual({ skipped: true, reason: 'disabled' });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it('sends a committed receipt with its exact amount and settles the durable delivery', async () => {
    mocks.enabled = true;
    mocks.prepare.mockResolvedValue({ lead: { id: 'lead-1', email: 'lead@example.com', phone: null, whatsapp: null }, delivery, shouldSend: true });
    mocks.config.mockReturnValue({ accessToken: 'server-only', datasetId: '908522268466201', graphApiVersion: 'v24.0' });
    mocks.build.mockReturnValue({ path: '/v24.0/908522268466201/events', body: { data: [] } });
    mocks.send.mockResolvedValue({ status: 'accepted' });
    mocks.settle.mockResolvedValue({ ...delivery, status: 'accepted', acceptedAt: occurrence.toISOString() });

    const result = await dispatchMetaCapiLiveEvent({
      leadId: 'lead-1', kind: 'converted', occurredAt: occurrence,
      sourceIdentity: 'payment:payment-1', purchaseValue: 300,
    });

    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ sourceIdentity: 'payment:payment-1' }));
    expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({
      deliveryEventId: delivery.eventId, purchaseValue: 300, occurredAt: occurrence,
    }));
    expect(mocks.settle).toHaveBeenCalledWith({ deliveryId: delivery.id, status: 'accepted', errorCode: null });
    expect(result).toMatchObject({ skipped: false, deduped: false, delivery: { status: 'accepted' } });
  });
});

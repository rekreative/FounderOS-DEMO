import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildMetaCapiLiveRequest, isMetaCapiLiveEnabled, sendMetaCapiLiveRequest } from '@/lib/server/meta-capi';

describe('Meta CAPI live V2', () => {
  it('is explicitly disabled until the server-only live flag is enabled', () => {
    expect(isMetaCapiLiveEnabled({})).toBe(false);
    expect(isMetaCapiLiveEnabled({ META_CAPI_LIVE_ENABLED: 'false' })).toBe(false);
    expect(isMetaCapiLiveEnabled({ META_CAPI_LIVE_ENABLED: 'true' })).toBe(true);
  });

  it('builds a live Purchase with a stable id and actual money collected, never a test code', () => {
    const request = buildMetaCapiLiveRequest({
      datasetId: '908522268466201',
      deliveryEventId: 'rekreos-live-lead-abc-converted',
      lead: {
        id: 'lead-abc',
        email: '  Sonia@Example.com ',
        phone: '+34 660 17 00 37',
        whatsapp: null,
        conversionCollection: { totalCollected: 300, outstandingAmount: 300, status: 'partial' },
      },
      kind: 'converted',
      occurredAt: new Date('2026-09-17T12:00:00.000Z'),
    });

    expect(request.path).toBe('/v24.0/908522268466201/events');
    expect(request.body).toEqual({
      data: [
        expect.objectContaining({
          event_name: 'Purchase',
          event_time: 1_789_646_400,
          event_id: 'rekreos-live-lead-abc-converted',
          action_source: 'system_generated',
          custom_data: { currency: 'EUR', value: 300 },
        }),
      ],
    });
    expect(JSON.stringify(request.body)).not.toContain('test_event_code');
    expect(JSON.stringify(request.body)).not.toContain('Sonia@Example.com');
  });

  it('uses the stable delivery identity when retrying a live request, so Meta can deduplicate it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const request = buildMetaCapiLiveRequest({
        datasetId: '908522268466201',
        deliveryEventId: 'rekreos-live-lead-abc-appointment',
        lead: { id: 'lead-abc', email: 'lead@example.com', phone: null, whatsapp: null },
        kind: 'appointment',
        occurredAt: new Date('2026-09-17T12:00:00.000Z'),
      });
      await expect(
        sendMetaCapiLiveRequest(
          { accessToken: 'never-in-the-url', datasetId: '908522268466201', graphApiVersion: 'v24.0' },
          request,
        ),
      ).resolves.toEqual({ status: 'accepted' });
      const body = String(fetchMock.mock.calls[0][1].body);
      expect(body).toContain('rekreos-live-lead-abc-appointment');
      expect(body).not.toContain('test_event_code');
      expect(fetchMock.mock.calls[0][0]).not.toContain('never-in-the-url');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps live deliveries isolated, durable, and limited to explicit server-side activation', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'lib', 'server', 'migrations', '0019_meta_capi_live_v2.sql'), 'utf8');
    expect(sql).toMatch(/delivery_mode IN \('test', 'live'\)/);
    expect(sql).toMatch(/UNIQUE \(lead_id, event_kind, delivery_mode, source_identity\)/);
    expect(sql).toMatch(/'meta_capi_live'/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/access_token|test_event_code/i);
  });
});

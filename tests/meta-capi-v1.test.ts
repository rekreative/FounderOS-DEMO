import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildMetaCapiTestRequest, getMetaCapiConfiguration, getMetaCapiEventDefinition, sendMetaCapiTestRequest } from '@/lib/server/meta-capi';
import { CreateMetaCapiTestEventBodySchema } from '@/lib/server/schemas';

describe('Meta CAPI V1', () => {
  it('maps REKREOS commercial signals to Meta standard events without inventing a QualifiedLead event', () => {
    expect(getMetaCapiEventDefinition('qualified_lead')).toEqual({ eventName: 'Lead', label: 'Lead cualificado' });
    expect(getMetaCapiEventDefinition('appointment')).toEqual({ eventName: 'Schedule', label: 'Cita' });
    expect(getMetaCapiEventDefinition('converted')).toEqual({ eventName: 'Purchase', label: 'Conversión' });
  });

  it('hashes normalized contact data and never places raw PII in the Meta request', () => {
    const request = buildMetaCapiTestRequest({
      datasetId: '908522268466201',
      testEventCode: 'TEST-ONLY-CODE',
      lead: {
        id: 'lead-abc',
        email: '  Sonia@Example.com ',
        phone: '+34 660 17 00 37',
        whatsapp: null,
        conversionCollection: undefined,
      },
      kind: 'qualified_lead',
      occurredAt: new Date('2026-09-16T12:00:00.000Z'),
    });

    expect(request.path).toBe('/v24.0/908522268466201/events');
    expect(request.body.data[0]).toMatchObject({
      event_name: 'Lead',
      event_time: 1_789_560_000,
      event_id: 'rekreos-test-lead-abc-qualified_lead',
      action_source: 'system_generated',
    });
    expect(request.body.data[0].user_data.em).toEqual(['56d06894c3bf3e0484420311bace3516b0fe0135ed125ad2ba767182a31db524']);
    expect(request.body.data[0].user_data.ph).toEqual(['383939e4d5bf9636dd0ce4a65a493998caa0b486830d3cb9ea474d301732ad6c']);
    expect(JSON.stringify(request.body)).not.toContain('Sonia@Example.com');
    expect(JSON.stringify(request.body)).not.toContain('+34 660 17 00 37');
    expect(request.body.test_event_code).toBe('TEST-ONLY-CODE');
  });

  it('uses actual money collected, rather than the agreement, for a conversion test value', () => {
    const request = buildMetaCapiTestRequest({
      datasetId: '908522268466201',
      testEventCode: 'TEST-ONLY-CODE',
      lead: {
        id: 'lead-converted',
        email: 'paid@example.com',
        phone: null,
        whatsapp: null,
        conversionCollection: { totalCollected: 300, outstandingAmount: 300, status: 'partial' },
      },
      kind: 'converted',
      occurredAt: new Date('2026-09-16T12:00:00.000Z'),
    });

    expect(request.body.data[0]).toMatchObject({
      event_name: 'Purchase',
      custom_data: { currency: 'EUR', value: 300 },
    });
  });

  it('rejects a test request without a controlled test code', () => {
    expect(CreateMetaCapiTestEventBodySchema.safeParse({ kind: 'qualified_lead' }).success).toBe(false);
    expect(CreateMetaCapiTestEventBodySchema.safeParse({ kind: 'not-a-real-event', testEventCode: 'x' }).success).toBe(false);
  });

  it('requires only server-side CAPI configuration and keeps the Graph version override constrained', () => {
    expect(getMetaCapiConfiguration({ META_CAPI_ACCESS_TOKEN: 'token', META_CAPI_DATASET_ID: '908522268466201' })).toEqual({
      accessToken: 'token',
      datasetId: '908522268466201',
      graphApiVersion: 'v24.0',
    });
    expect(() => getMetaCapiConfiguration({ META_CAPI_ACCESS_TOKEN: 'token', META_CAPI_DATASET_ID: 'bad' })).toThrow(
      'Meta CAPI is not configured',
    );
    expect(() =>
      getMetaCapiConfiguration({
        META_CAPI_ACCESS_TOKEN: 'token',
        META_CAPI_DATASET_ID: '908522268466201',
        META_CAPI_GRAPH_VERSION: 'https://bad.example',
      }),
    ).toThrow('Meta CAPI is not configured');
  });

  it('posts a test request to Meta without placing the access token in the URL or returning provider diagnostics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events_received: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const request = buildMetaCapiTestRequest({
        datasetId: '908522268466201',
        testEventCode: 'TEST-ONLY-CODE',
        lead: { id: 'lead-send', email: 'send@example.com', phone: null, whatsapp: null },
        kind: 'appointment',
        occurredAt: new Date('2026-09-16T12:00:00.000Z'),
      });
      await expect(
        sendMetaCapiTestRequest(
          { accessToken: 'never-in-the-url', datasetId: '908522268466201', graphApiVersion: 'v24.0' },
          request,
        ),
      ).resolves.toEqual({ status: 'accepted' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.facebook.com/v24.0/908522268466201/events',
        expect.objectContaining({ method: 'POST' }),
      );
      const body = String(fetchMock.mock.calls[0][1].body);
      expect(body).toContain('never-in-the-url');
      expect(fetchMock.mock.calls[0][0]).not.toContain('never-in-the-url');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('adds a durable test-delivery ledger and timeline event type without storing the test code', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'lib', 'server', 'migrations', '0018_meta_capi_test_v1.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS lead_meta_capi_deliveries/);
    expect(sql).toMatch(/UNIQUE \(lead_id, event_kind, delivery_mode\)/);
    expect(sql).toMatch(/'pending', 'accepted', 'failed'/);
    expect(sql).toMatch(/'meta_capi_test'/);
    expect(sql).not.toMatch(/test_event_code/i);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });
});

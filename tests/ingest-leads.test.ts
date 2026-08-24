import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkIngestAuth } from '@/lib/server/ingest-auth';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { POST } from '@/app/api/ingest/leads/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

// ── Pure auth unit tests — no DB needed, always run ─────────────────────
describe('checkIngestAuth', () => {
  const originalKey = process.env.INGEST_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.INGEST_API_KEY;
    else process.env.INGEST_API_KEY = originalKey;
  });

  const req = (headers: Record<string, string> = {}) => new Request('http://x/api/ingest/leads', { method: 'POST', headers });

  it('fails closed when INGEST_API_KEY is not configured, regardless of the header sent', () => {
    delete process.env.INGEST_API_KEY;
    expect(checkIngestAuth(req({ authorization: 'Bearer whatever' }))).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('rejects a missing Authorization header', () => {
    process.env.INGEST_API_KEY = 'secret-key';
    expect(checkIngestAuth(req())).toEqual({ ok: false, reason: 'missing_header' });
  });

  it('rejects a malformed (non-Bearer) Authorization header', () => {
    process.env.INGEST_API_KEY = 'secret-key';
    expect(checkIngestAuth(req({ authorization: 'Basic abc123' }))).toEqual({ ok: false, reason: 'malformed_header' });
  });

  it('rejects the wrong token', () => {
    process.env.INGEST_API_KEY = 'secret-key';
    expect(checkIngestAuth(req({ authorization: 'Bearer wrong-token' }))).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('accepts the correct token', () => {
    process.env.INGEST_API_KEY = 'secret-key';
    expect(checkIngestAuth(req({ authorization: 'Bearer secret-key' }))).toEqual({ ok: true });
  });
});

// ── Integration tests against the real local dev PostgreSQL ────────────
const TEST_DATABASE_URL = installTestDatabaseUrl();
const TEST_INGEST_KEY = 'test-ingest-key-for-vitest';

describe.runIf(Boolean(TEST_DATABASE_URL))('POST /api/ingest/leads (real PostgreSQL)', () => {
  const originalKey = process.env.INGEST_API_KEY;
  const createdLeadIds: string[] = [];
  const createdClientIds: string[] = [];

  beforeAll(() => {
    process.env.INGEST_API_KEY = TEST_INGEST_KEY;
  });

  afterAll(async () => {
    if (originalKey === undefined) delete process.env.INGEST_API_KEY;
    else process.env.INGEST_API_KEY = originalKey;
    await closePool();
  });

  afterEach(async () => {
    const leadIds = createdLeadIds.splice(0);
    if (leadIds.length > 0) {
      await query('DELETE FROM lead_events WHERE lead_id = ANY($1)', [leadIds]);
      await query('DELETE FROM leads WHERE id = ANY($1)', [leadIds]);
    }
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE client_id = $1)', [id]);
      await query('DELETE FROM leads WHERE client_id = $1', [id]);
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  function post(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TEST_INGEST_KEY}` }) {
    return POST(new Request('http://x/api/ingest/leads', { method: 'POST', headers, body: JSON.stringify(body) }));
  }

  async function makeClient() {
    const client = await createClient({
      name: 'Ingest Test Client',
      sector: 'Testing',
      status: 'prospect',
      service: 'Route test fixture',
      metaBudgetMonthly: 0,
      startDate: '2026-01-01',
      owner: 'test-suite',
    });
    createdClientIds.push(client.id);
    return client;
  }

  const rand = () => Math.random().toString(36).slice(2);
  const baseBody = (overrides: Record<string, unknown> = {}) => ({
    deliveryId: `delivery-${rand()}`,
    ingestionSource: 'meta',
    externalLeadId: `meta-lead-${rand()}`,
    leadSource: 'Meta Ads',
    scope: 'internal',
    name: 'Lead Ingest Test',
    ...overrides,
  });

  async function postAndTrack(body: unknown) {
    const res = await post(body);
    const json = (await res.json()) as { leadId?: string };
    if (json.leadId) createdLeadIds.push(json.leadId);
    return { res, json };
  }

  describe('auth', () => {
    it('401s on a missing auth header', async () => {
      expect((await post(baseBody(), {})).status).toBe(401);
    });

    it('401s on a malformed (non-Bearer) auth header', async () => {
      expect((await post(baseBody(), { authorization: 'Basic xyz' })).status).toBe(401);
    });

    it('401s on the wrong token', async () => {
      expect((await post(baseBody(), { authorization: 'Bearer wrong-token' })).status).toBe(401);
    });

    it('fails closed (500) when INGEST_API_KEY is unset, even with a token sent', async () => {
      delete process.env.INGEST_API_KEY;
      try {
        expect((await post(baseBody())).status).toBe(500);
      } finally {
        process.env.INGEST_API_KEY = TEST_INGEST_KEY;
      }
    });

    it('201s with the correct token', async () => {
      const { res } = await postAndTrack(baseBody({ name: 'Valid Token Check' }));
      expect(res.status).toBe(201);
    });
  });

  describe('validation', () => {
    it('creates a valid internal lead', async () => {
      const { res, json } = await postAndTrack(baseBody({ name: 'Internal Valid' }));
      expect(res.status).toBe(201);
      expect(json).toMatchObject({ ok: true, deduped: false });
    });

    it('creates a valid client-scoped lead linked to the right client', async () => {
      const client = await makeClient();
      const { res, json } = await postAndTrack(baseBody({ scope: 'client', clientId: client.id, name: 'Client Valid' }));
      expect(res.status).toBe(201);
      const row = await query('SELECT client_id FROM leads WHERE id = $1', [json.leadId]);
      expect(row.rows[0].client_id).toBe(client.id);
    });

    it('422s when scope=client but clientId is missing', async () => {
      expect((await post(baseBody({ scope: 'client', name: 'No Client' }))).status).toBe(422);
    });

    it('422s when scope=internal but clientId is present', async () => {
      const client = await makeClient();
      expect((await post(baseBody({ scope: 'internal', clientId: client.id, name: 'Should Not Allow' }))).status).toBe(422);
    });

    it('422s on an unknown client', async () => {
      expect((await post(baseBody({ scope: 'client', clientId: 'client-does-not-exist', name: 'Ghost' }))).status).toBe(422);
    });

    it('400s on an invalid intent', async () => {
      expect((await post(baseBody({ aiAnalysis: { intent: 'furious' } }))).status).toBe(400);
    });

    it('400s on an invalid priority', async () => {
      expect((await post(baseBody({ aiAnalysis: { priority: 'urgent' } }))).status).toBe(400);
    });

    it('400s on an arbitrary unknown field — Make can never choose a stage', async () => {
      expect((await post(baseBody({ stage: 'converted' }))).status).toBe(400);
    });
  });

  describe('idempotency', () => {
    it('same deliveryId replay: 201 then 200 deduped, no duplicate row or event', async () => {
      const body = baseBody({ name: 'Delivery Replay Test' });
      const first = await postAndTrack(body);
      expect(first.res.status).toBe(201);
      expect(first.json).toMatchObject({ deduped: false });

      const second = await postAndTrack(body);
      expect(second.res.status).toBe(200);
      expect(second.json).toMatchObject({ deduped: true, leadId: first.json.leadId });

      const events = await query('SELECT id FROM lead_events WHERE lead_id = $1', [first.json.leadId]);
      expect(events.rowCount).toBe(1);
    });

    it('same external identity via a different deliveryId: 200 deduped, no duplicate row', async () => {
      const externalLeadId = `meta-lead-${rand()}`;
      const first = await postAndTrack(baseBody({ externalLeadId, name: 'Same External A' }));
      expect(first.res.status).toBe(201);

      const second = await postAndTrack(baseBody({ externalLeadId, name: 'Same External B' }));
      expect(second.res.status).toBe(200);
      expect(second.json).toMatchObject({ deduped: true, leadId: first.json.leadId });
    });

    it('a genuinely different external lead creates a new row', async () => {
      const first = await postAndTrack(baseBody({ name: 'Distinct A' }));
      const second = await postAndTrack(baseBody({ name: 'Distinct B' }));
      expect(first.json.leadId).not.toBe(second.json.leadId);
      expect(second.json).toMatchObject({ deduped: false });
    });

    it('manual ingestion with no externalLeadId is still deduped by deliveryId alone', async () => {
      const body = baseBody({ ingestionSource: 'manual', externalLeadId: undefined, name: 'No External Id' });
      const first = await postAndTrack(body);
      const second = await postAndTrack(body);
      expect(second.json).toMatchObject({ deduped: true, leadId: first.json.leadId });
    });
  });

  describe('data correctness', () => {
    it('stores an internal lead with client_id NULL', async () => {
      const { json } = await postAndTrack(baseBody({ name: 'Internal Data Check' }));
      const row = await query('SELECT scope, client_id FROM leads WHERE id = $1', [json.leadId]);
      expect(row.rows[0]).toEqual({ scope: 'internal', client_id: null });
    });

    it('stores leadSource separately from ingestionSource/externalLeadId/deliveryId', async () => {
      const deliveryId = `delivery-${rand()}`;
      const externalLeadId = `meta-lead-${rand()}`;
      const { json } = await postAndTrack(
        baseBody({ deliveryId, externalLeadId, leadSource: 'Meta Ads', ingestionSource: 'meta', name: 'Source Separation' }),
      );
      const row = await query(
        'SELECT lead_source, ingestion_source, external_lead_id, ingest_delivery_id FROM leads WHERE id = $1',
        [json.leadId],
      );
      expect(row.rows[0]).toEqual({
        lead_source: 'Meta Ads',
        ingestion_source: 'meta',
        external_lead_id: externalLeadId,
        ingest_delivery_id: deliveryId,
      });
    });

    it('stores Meta attribution identifiers when supplied (Meta Ads Real V1, additive)', async () => {
      const { json } = await postAndTrack(
        baseBody({
          name: 'Meta Attribution Check',
          metaCampaignId: 'camp-123',
          metaAdsetId: 'adset-456',
          metaAdId: 'ad-789',
          metaFormId: 'form-321',
        }),
      );
      const row = await query('SELECT meta_campaign_id, meta_adset_id, meta_ad_id, meta_form_id FROM leads WHERE id = $1', [json.leadId]);
      expect(row.rows[0]).toEqual({
        meta_campaign_id: 'camp-123',
        meta_adset_id: 'adset-456',
        meta_ad_id: 'ad-789',
        meta_form_id: 'form-321',
      });
    });

    it('backward compatibility: a payload with no Meta attribution fields still ingests, with all four columns null', async () => {
      const { res, json } = await postAndTrack(baseBody({ name: 'No Meta Attribution — Legacy Payload' }));
      expect(res.status).toBe(201);
      const row = await query('SELECT meta_campaign_id, meta_adset_id, meta_ad_id, meta_form_id FROM leads WHERE id = $1', [json.leadId]);
      expect(row.rows[0]).toEqual({ meta_campaign_id: null, meta_adset_id: null, meta_ad_id: null, meta_form_id: null });
    });

    it('stores aiAnalysis fields correctly', async () => {
      const { json } = await postAndTrack(
        baseBody({
          name: 'AI Fields Check',
          aiAnalysis: { summary: 'Great fit', intent: 'hot', priority: 'high', qualification: { pain: 'x' } },
        }),
      );
      const row = await query('SELECT ai_intent, ai_priority, ai_summary, ai_qualification FROM leads WHERE id = $1', [json.leadId]);
      expect(row.rows[0]).toEqual({ ai_intent: 'hot', ai_priority: 'high', ai_summary: 'Great fit', ai_qualification: { pain: 'x' } });
    });

    it('stores qualificationAnswers correctly', async () => {
      const { json } = await postAndTrack(baseBody({ name: 'Qualification Check', qualificationAnswers: { budget: 'high' } }));
      const row = await query('SELECT qualification_answers FROM leads WHERE id = $1', [json.leadId]);
      expect(row.rows[0].qualification_answers).toEqual({ budget: 'high' });
    });

    it('appends exactly one lead_received event, sourced "make", for a new lead', async () => {
      const { json } = await postAndTrack(baseBody({ name: 'Single Event Check' }));
      const events = await query('SELECT type, source FROM lead_events WHERE lead_id = $1', [json.leadId]);
      expect(events.rows).toEqual([{ type: 'lead_received', source: 'make' }]);
    });

    it('appends no extra event on a duplicate delivery', async () => {
      const body = baseBody({ name: 'No Extra Event On Dup' });
      const first = await postAndTrack(body);
      await post(body); // replay, not tracked separately — same lead
      const events = await query('SELECT id FROM lead_events WHERE lead_id = $1', [first.json.leadId]);
      expect(events.rowCount).toBe(1);
    });

    it('with aiAnalysis: stamps ai_analyzed_at and appends lead_received then ai_analyzed (make, then openai)', async () => {
      const { json } = await postAndTrack(
        baseBody({
          name: 'AI Analyzed Ingest',
          aiAnalysis: { summary: 'Great fit', intent: 'hot', priority: 'high', qualification: { pain: 'x' } },
        }),
      );

      const leadRow = await query('SELECT ai_analyzed_at FROM leads WHERE id = $1', [json.leadId]);
      expect(leadRow.rows[0].ai_analyzed_at).not.toBeNull();

      const events = await query('SELECT type, source FROM lead_events WHERE lead_id = $1 ORDER BY occurred_at ASC, created_at ASC', [
        json.leadId,
      ]);
      expect(events.rows).toEqual([
        { type: 'lead_received', source: 'make' },
        { type: 'ai_analyzed', source: 'openai' },
      ]);
    });

    it('without aiAnalysis: ai_analyzed_at stays null and only lead_received is appended', async () => {
      const { json } = await postAndTrack(baseBody({ name: 'No AI Ingest' }));

      const leadRow = await query('SELECT ai_analyzed_at FROM leads WHERE id = $1', [json.leadId]);
      expect(leadRow.rows[0].ai_analyzed_at).toBeNull();

      const events = await query('SELECT type FROM lead_events WHERE lead_id = $1', [json.leadId]);
      expect(events.rows).toEqual([{ type: 'lead_received' }]);
    });
  });

  describe('idempotency with AI analysis', () => {
    it('same deliveryId replay with aiAnalysis: deduped, event count stays at 2', async () => {
      const body = baseBody({
        name: 'AI Delivery Replay',
        aiAnalysis: { summary: 'Great fit', intent: 'hot', priority: 'high', qualification: null },
      });
      const first = await postAndTrack(body);
      expect(first.res.status).toBe(201);

      const second = await postAndTrack(body);
      expect(second.res.status).toBe(200);
      expect(second.json).toMatchObject({ deduped: true, leadId: first.json.leadId });

      const events = await query('SELECT id FROM lead_events WHERE lead_id = $1', [first.json.leadId]);
      expect(events.rowCount).toBe(2);
    });

    it('same external identity via a different deliveryId, with aiAnalysis: deduped, event count stays at 2', async () => {
      const externalLeadId = `meta-lead-${rand()}`;
      const aiAnalysis = { summary: 'Great fit', intent: 'hot', priority: 'high', qualification: null };

      const first = await postAndTrack(baseBody({ externalLeadId, name: 'AI External A', aiAnalysis }));
      expect(first.res.status).toBe(201);

      const second = await postAndTrack(baseBody({ externalLeadId, name: 'AI External B', aiAnalysis }));
      expect(second.res.status).toBe(200);
      expect(second.json).toMatchObject({ deduped: true, leadId: first.json.leadId });

      const events = await query('SELECT id FROM lead_events WHERE lead_id = $1', [first.json.leadId]);
      expect(events.rowCount).toBe(2);
    });
  });

  describe('security', () => {
    it('never echoes the bearer token in the response body', async () => {
      const { json } = await postAndTrack(baseBody({ name: 'Token Echo Check' }));
      expect(JSON.stringify(json)).not.toContain(TEST_INGEST_KEY);
    });
  });
});

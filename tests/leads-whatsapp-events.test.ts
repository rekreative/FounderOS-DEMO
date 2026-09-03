import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkMakeEventsAuth } from '@/lib/server/make-events-auth';
import { closePool, query } from '@/lib/server/db';
import { createLead, getLeadById, listLeadEvents, setLeadStage } from '@/lib/server/leads-repo';
import { createClient } from '@/lib/server/clients-repo';
import { createWhatsAppBusinessNumber } from '@/lib/server/whatsapp-repo';
import { POST } from '@/app/api/leads/whatsapp-events/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

// ── Pure auth unit tests — no DB needed, always run ─────────────────────
describe('checkMakeEventsAuth', () => {
  const originalKey = process.env.MAKE_EVENTS_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.MAKE_EVENTS_API_KEY;
    else process.env.MAKE_EVENTS_API_KEY = originalKey;
  });

  const req = (headers: Record<string, string> = {}) =>
    new Request('http://x/api/leads/whatsapp-events', { method: 'POST', headers });

  it('fails closed when MAKE_EVENTS_API_KEY is not configured, regardless of the header sent', () => {
    delete process.env.MAKE_EVENTS_API_KEY;
    expect(checkMakeEventsAuth(req({ authorization: 'Bearer whatever' }))).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('rejects a missing Authorization header', () => {
    process.env.MAKE_EVENTS_API_KEY = 'secret-key';
    expect(checkMakeEventsAuth(req())).toEqual({ ok: false, reason: 'missing_header' });
  });

  it('rejects a malformed (non-Bearer) Authorization header', () => {
    process.env.MAKE_EVENTS_API_KEY = 'secret-key';
    expect(checkMakeEventsAuth(req({ authorization: 'Basic abc123' }))).toEqual({ ok: false, reason: 'malformed_header' });
  });

  it('rejects the wrong token', () => {
    process.env.MAKE_EVENTS_API_KEY = 'secret-key';
    expect(checkMakeEventsAuth(req({ authorization: 'Bearer wrong-token' }))).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('accepts the correct token', () => {
    process.env.MAKE_EVENTS_API_KEY = 'secret-key';
    expect(checkMakeEventsAuth(req({ authorization: 'Bearer secret-key' }))).toEqual({ ok: true });
  });

  it('is a dedicated key, distinct from INGEST_API_KEY', () => {
    process.env.MAKE_EVENTS_API_KEY = 'make-events-secret';
    process.env.INGEST_API_KEY = 'ingest-secret';
    expect(checkMakeEventsAuth(req({ authorization: 'Bearer ingest-secret' }))).toEqual({ ok: false, reason: 'invalid_token' });
    delete process.env.INGEST_API_KEY;
  });
});

// ── Integration tests against a real Postgres test database ─────────────
// Requires an explicit TEST_DATABASE_URL (see tests/helpers/pg-test-env.ts)
// - never DATABASE_URL/.env.local, which may be production.
const TEST_DATABASE_URL = installTestDatabaseUrl();
const TEST_KEY = 'test-make-events-key-for-vitest';

describe.runIf(Boolean(TEST_DATABASE_URL))('POST /api/leads/whatsapp-events (real PostgreSQL)', () => {
  const originalKey = process.env.MAKE_EVENTS_API_KEY;
  const createdLeadIds: string[] = [];
  const createdClientIds: string[] = [];
  const createdBusinessNumberIds: string[] = [];

  beforeAll(() => {
    process.env.MAKE_EVENTS_API_KEY = TEST_KEY;
  });

  afterAll(async () => {
    if (originalKey === undefined) delete process.env.MAKE_EVENTS_API_KEY;
    else process.env.MAKE_EVENTS_API_KEY = originalKey;
    await closePool();
  });

  afterEach(async () => {
    const ids = createdLeadIds.splice(0);
    if (ids.length > 0) {
      await query('DELETE FROM lead_events WHERE lead_id = ANY($1)', [ids]);
      await query('DELETE FROM leads WHERE id = ANY($1)', [ids]);
    }
    if (createdBusinessNumberIds.length > 0) {
      await query('DELETE FROM whatsapp_business_numbers WHERE id = ANY($1)', [createdBusinessNumberIds.splice(0)]);
    }
    if (createdClientIds.length > 0) {
      await query('DELETE FROM clients WHERE id = ANY($1)', [createdClientIds.splice(0)]);
    }
  });

  async function makeLead(overrides: Partial<Parameters<typeof createLead>[0]> = {}) {
    const { lead } = await createLead({
      scope: 'internal',
      name: 'WhatsApp Event Test Lead',
      whatsapp: '+34612345678',
      ...overrides,
    });
    createdLeadIds.push(lead.id);
    return lead;
  }

  async function makeBusinessNumber(
    overrides: Partial<Parameters<typeof createWhatsAppBusinessNumber>[0]> = {},
  ) {
    const number = await createWhatsAppBusinessNumber({
      ownerScope: 'internal',
      phoneNumberId: `pn-${Date.now()}`.replace(/\D/g, ''),
      validFrom: '2026-01-01T00:00:00.000Z',
      ...overrides,
    });
    createdBusinessNumberIds.push(number.id);
    return number;
  }

  function inboundBody(
    phoneNumberId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      type: 'lead_replied',
      whatsappNumber: '34612345678',
      phoneNumberId,
      externalEventId: `wamid.reply-${Date.now()}-${Math.random()}`,
      occurredAt: '2026-09-03T08:00:00.000Z',
      ...overrides,
    };
  }

  function postEvent(body: unknown) {
    return POST(
      new Request('http://x/api/leads/whatsapp-events', {
        method: 'POST',
        headers: { authorization: `Bearer ${TEST_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  it('accepts an authenticated whatsapp_sent for a known lead, sourced "make"', async () => {
    const lead = await makeLead();
    const res = await postEvent({ type: 'whatsapp_sent', leadId: lead.id, externalEventId: 'wamid.sent-1' });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.matched).toBe(true);
    expect(json.event.type).toBe('whatsapp_sent');
    expect(json.event.source).toBe('make');
  });

  it('advances stage new → contacted on whatsapp_sent', async () => {
    const lead = await makeLead();
    expect(lead.stage).toBe('new');

    await postEvent({ type: 'whatsapp_sent', leadId: lead.id, externalEventId: 'wamid.sent-2' });

    const reloaded = await getLeadById(lead.id);
    expect(reloaded?.stage).toBe('contacted');

    const events = await listLeadEvents(lead.id);
    expect(events.map((e) => e.type)).toEqual(['lead_received', 'whatsapp_sent', 'stage_changed']);
    expect(events[2].source).toBe('make');
  });

  it('never moves a lead already past contacted backwards on whatsapp_sent', async () => {
    const lead = await makeLead();
    await setLeadStage(lead.id, 'qualified');

    const res = await postEvent({ type: 'whatsapp_sent', leadId: lead.id, externalEventId: 'wamid.sent-3' });
    expect(res.status).toBe(201);

    const reloaded = await getLeadById(lead.id);
    expect(reloaded?.stage).toBe('qualified');
  });

  it('whatsapp_delivered creates an event, sourced "whatsapp", and never changes stage', async () => {
    const lead = await makeLead();
    const res = await postEvent({ type: 'whatsapp_delivered', leadId: lead.id, externalEventId: 'wamid.delivered-1' });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.event.source).toBe('whatsapp');

    const reloaded = await getLeadById(lead.id);
    expect(reloaded?.stage).toBe('new');
  });

  it('lead_replied creates an event, sourced "whatsapp", and does not auto-qualify the lead', async () => {
    const lead = await makeLead();
    const number = await makeBusinessNumber();
    const res = await postEvent(inboundBody(number.phoneNumberId, { externalEventId: 'wamid.reply-1' }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.matched).toBe(true);
    expect(json.leadId).toBe(lead.id);
    expect(json.event.type).toBe('lead_replied');
    expect(json.event.source).toBe('whatsapp');

    const reloaded = await getLeadById(lead.id);
    expect(reloaded?.stage).toBe('new');
  });

  it('resolves an inbound event by WhatsApp number regardless of punctuation/prefix differences', async () => {
    const lead = await makeLead({ whatsapp: '+34 612 345 679' });
    const number = await makeBusinessNumber();
    const res = await postEvent(
      inboundBody(number.phoneNumberId, {
        whatsappNumber: '0034612345679',
        externalEventId: 'wamid.reply-2',
      }),
    );
    const json = await res.json();
    expect(json.matched).toBe(true);
    expect(json.leadId).toBe(lead.id);
  });

  it('returns a safe no-op for an unmatched WhatsApp number and creates no lead', async () => {
    const unmatchedNumber = '19995550000';
    const number = await makeBusinessNumber();
    const before = await query<{ count: number }>(
      'SELECT count(*)::int AS count FROM leads WHERE whatsapp_normalized = $1',
      [unmatchedNumber],
    );
    expect(before.rows[0].count).toBe(0);

    const res = await postEvent(
      inboundBody(number.phoneNumberId, {
        whatsappNumber: unmatchedNumber,
        externalEventId: 'wamid.unmatched',
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, matched: false, reason: 'lead_not_found' });

    const after = await query<{ count: number }>(
      'SELECT count(*)::int AS count FROM leads WHERE whatsapp_normalized = $1',
      [unmatchedNumber],
    );
    expect(after.rows[0].count).toBe(0);
  });

  it('routes the same sender number to the owner selected by Phone Number ID', async () => {
    const internalLead = await makeLead({ name: 'Internal same phone' });
    const client = await createClient({
      name: 'WhatsApp Tenant Test',
      sector: 'Test',
      status: 'active',
      service: 'Test',
      metaBudgetMonthly: 0,
      startDate: '2026-09-01',
      owner: 'Test',
    });
    createdClientIds.push(client.id);
    const clientLead = await makeLead({
      scope: 'client',
      clientId: client.id,
      name: 'Client same phone',
    });
    const internalNumber = await makeBusinessNumber({ phoneNumberId: '100000000001' });
    const clientNumber = await makeBusinessNumber({
      ownerScope: 'client',
      clientId: client.id,
      phoneNumberId: '100000000002',
    });

    const internalResponse = await postEvent(
      inboundBody(internalNumber.phoneNumberId, { externalEventId: 'wamid.tenant-internal' }),
    );
    expect((await internalResponse.json()).leadId).toBe(internalLead.id);

    const clientResponse = await postEvent(
      inboundBody(clientNumber.phoneNumberId, { externalEventId: 'wamid.tenant-client' }),
    );
    expect((await clientResponse.json()).leadId).toBe(clientLead.id);
  });

  it('rejects an unmapped Phone Number ID', async () => {
    await makeLead();
    const res = await postEvent(inboundBody('999999999999', { externalEventId: 'wamid.unmapped' }));
    expect(res.status).toBe(422);
  });

  it('rejects a message outside the mapping validity interval', async () => {
    await makeLead();
    const number = await makeBusinessNumber({
      phoneNumberId: '100000000004',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2026-08-01T00:00:00.000Z',
    });
    const res = await postEvent(inboundBody(number.phoneNumberId, { externalEventId: 'wamid.inactive' }));
    expect(res.status).toBe(422);
  });

  it('rejects a WABA mismatch when the mapping has a canonical WABA ID', async () => {
    await makeLead();
    const number = await makeBusinessNumber({ phoneNumberId: '100000000005', wabaId: '200000000001' });
    const res = await postEvent(
      inboundBody(number.phoneNumberId, {
        wabaId: '200000000002',
        externalEventId: 'wamid.waba-mismatch',
      }),
    );
    expect(res.status).toBe(422);
  });

  it('rejects an ambiguous number inside one owner instead of using LIMIT 1', async () => {
    await makeLead({ name: 'Duplicate one' });
    await makeLead({ name: 'Duplicate two' });
    const number = await makeBusinessNumber({ phoneNumberId: '100000000003' });
    const res = await postEvent(inboundBody(number.phoneNumberId, { externalEventId: 'wamid.ambiguous' }));
    expect(res.status).toBe(409);
    const events = await query(
      "SELECT 1 FROM lead_events WHERE type = 'lead_replied' AND external_event_id = $1",
      ['wamid.ambiguous'],
    );
    expect(events.rowCount).toBe(0);
  });

  it('stores the exact business-number mapping used by the inbound event', async () => {
    const lead = await makeLead();
    const number = await makeBusinessNumber({ phoneNumberId: '100000000006' });
    const res = await postEvent(
      inboundBody(number.phoneNumberId, { externalEventId: 'wamid.mapping-trace' }),
    );
    expect(res.status).toBe(201);
    const stored = await query<{ lead_id: string; whatsapp_business_number_id: string }>(
      `SELECT lead_id, whatsapp_business_number_id
       FROM lead_events
       WHERE type = 'lead_replied' AND external_event_id = $1`,
      ['wamid.mapping-trace'],
    );
    expect(stored.rows[0]).toEqual({ lead_id: lead.id, whatsapp_business_number_id: number.id });
  });

  it('rejects a duplicate Message ID that resolves to another owner and lead', async () => {
    const internalLead = await makeLead({ name: 'First owner lead' });
    const client = await createClient({
      name: 'Transferred WhatsApp Owner',
      sector: 'Test',
      status: 'active',
      service: 'Test',
      metaBudgetMonthly: 0,
      startDate: '2026-09-01',
      owner: 'Test',
    });
    createdClientIds.push(client.id);
    const clientLead = await makeLead({
      scope: 'client',
      clientId: client.id,
      name: 'Second owner lead',
    });
    const oldMapping = await makeBusinessNumber({
      phoneNumberId: '100000000007',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2026-09-04T00:00:00.000Z',
    });
    const newMapping = await makeBusinessNumber({
      ownerScope: 'client',
      clientId: client.id,
      phoneNumberId: oldMapping.phoneNumberId,
      validFrom: '2026-09-04T00:00:00.000Z',
    });

    const first = await postEvent(
      inboundBody(oldMapping.phoneNumberId, {
        externalEventId: 'wamid.transfer-conflict',
        occurredAt: '2026-09-03T08:00:00.000Z',
      }),
    );
    expect(first.status).toBe(201);
    expect((await first.json()).leadId).toBe(internalLead.id);

    const conflictingReplay = await postEvent(
      inboundBody(newMapping.phoneNumberId, {
        externalEventId: 'wamid.transfer-conflict',
        occurredAt: '2026-09-05T08:00:00.000Z',
      }),
    );
    expect(conflictingReplay.status).toBe(409);
    const stored = await query<{ lead_id: string }>(
      "SELECT lead_id FROM lead_events WHERE type = 'lead_replied' AND external_event_id = $1",
      ['wamid.transfer-conflict'],
    );
    expect(stored.rows).toEqual([{ lead_id: internalLead.id }]);
    expect(stored.rows[0].lead_id).not.toBe(clientLead.id);
  });

  it('prevents overlapping ownership intervals for one Phone Number ID', async () => {
    await makeBusinessNumber({
      phoneNumberId: '100000000008',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2026-10-01T00:00:00.000Z',
    });
    await expect(
      createWhatsAppBusinessNumber({
        ownerScope: 'internal',
        phoneNumberId: '100000000008',
        validFrom: '2026-09-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('is idempotent on a duplicate (type, externalEventId) replay', async () => {
    const lead = await makeLead();
    const first = await postEvent({ type: 'whatsapp_sent', leadId: lead.id, externalEventId: 'wamid.dup' });
    expect(first.status).toBe(201);

    const second = await postEvent({ type: 'whatsapp_sent', leadId: lead.id, externalEventId: 'wamid.dup' });
    expect(second.status).toBe(200);
    const json2 = await second.json();
    expect(json2.deduped).toBe(true);

    const events = await listLeadEvents(lead.id);
    expect(events.filter((e) => e.type === 'whatsapp_sent')).toHaveLength(1);
  });

  it('allows the same externalEventId across different event types', async () => {
    const lead = await makeLead();
    await postEvent({ type: 'whatsapp_sent', leadId: lead.id, externalEventId: 'wamid.shared' });
    const res2 = await postEvent({ type: 'whatsapp_delivered', leadId: lead.id, externalEventId: 'wamid.shared' });
    expect(res2.status).toBe(201);
    const json2 = await res2.json();
    expect(json2.deduped).toBe(false);

    const events = await listLeadEvents(lead.id);
    expect(events.map((e) => e.type)).toContain('whatsapp_sent');
    expect(events.map((e) => e.type)).toContain('whatsapp_delivered');
  });

  it('rejects an unknown leadId with 404 (Make already has a real id from ingestion)', async () => {
    const res = await postEvent({ type: 'whatsapp_sent', leadId: 'lead-does-not-exist', externalEventId: 'wamid.404' });
    expect(res.status).toBe(404);
  });

  it('fails closed without a valid MAKE_EVENTS_API_KEY', async () => {
    const res = await POST(
      new Request('http://x/api/leads/whatsapp-events', {
        method: 'POST',
        headers: { authorization: 'Bearer wrong-key', 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'whatsapp_sent', leadId: 'whatever', externalEventId: 'x' }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a payload missing externalEventId', async () => {
    const lead = await makeLead();
    const res = await postEvent({ type: 'whatsapp_sent', leadId: lead.id });
    expect(res.status).toBe(400);
  });

  it('rejects a payload carrying both leadId and whatsappNumber', async () => {
    const lead = await makeLead();
    const res = await postEvent({
      type: 'whatsapp_sent',
      leadId: lead.id,
      whatsappNumber: '34612345678',
      externalEventId: 'wamid.both',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a payload carrying neither leadId nor whatsappNumber', async () => {
    const res = await postEvent({ type: 'whatsapp_sent', externalEventId: 'wamid.neither' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid event type', async () => {
    const lead = await makeLead();
    const res = await postEvent({ type: 'not_a_real_type', leadId: lead.id, externalEventId: 'wamid.badtype' });
    expect(res.status).toBe(400);
  });
});

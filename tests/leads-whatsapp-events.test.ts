import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkMakeEventsAuth } from '@/lib/server/make-events-auth';
import { closePool, query } from '@/lib/server/db';
import { createLead, findByWhatsapp, getLeadById, listLeadEvents, setLeadStage } from '@/lib/server/leads-repo';
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
    const res = await postEvent({ type: 'lead_replied', whatsappNumber: '34612345678', externalEventId: 'wamid.reply-1' });
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
    const res = await postEvent({ type: 'lead_replied', whatsappNumber: '0034612345679', externalEventId: 'wamid.reply-2' });
    const json = await res.json();
    expect(json.matched).toBe(true);
    expect(json.leadId).toBe(lead.id);
  });

  it('returns a safe no-op for an unmatched WhatsApp number and creates no lead', async () => {
    const unmatchedNumber = '19995550000';
    expect(await findByWhatsapp(unmatchedNumber)).toBeNull();

    const res = await postEvent({ type: 'lead_replied', whatsappNumber: unmatchedNumber, externalEventId: 'wamid.unmatched' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, matched: false });

    expect(await findByWhatsapp(unmatchedNumber)).toBeNull();
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

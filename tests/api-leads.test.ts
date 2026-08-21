import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { GET as GET_ONE, PATCH } from '@/app/api/leads/[id]/route';
import { GET as GET_EVENTS, POST as POST_EVENT } from '@/app/api/leads/[id]/events/route';
import { POST as POST_STAGE } from '@/app/api/leads/[id]/stage/route';
import { GET, POST } from '@/app/api/leads/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

const list = (query_: string = '') => GET(new Request(`http://x/api/leads${query_}`));
const post = (body: unknown) => POST(new Request('http://x/api/leads', { method: 'POST', body: JSON.stringify(body) }));
const getOne = (id: string) => GET_ONE(new Request(`http://x/api/leads/${id}`), { params: { id } });
const patch = (id: string, body: unknown) =>
  PATCH(new Request(`http://x/api/leads/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: { id } });
const postStage = (id: string, stage: string) =>
  POST_STAGE(new Request(`http://x/api/leads/${id}/stage`, { method: 'POST', body: JSON.stringify({ stage }) }), {
    params: { id },
  });
const getEvents = (id: string) => GET_EVENTS(new Request(`http://x/api/leads/${id}/events`), { params: { id } });
const postEvent = (id: string, body: unknown) =>
  POST_EVENT(new Request(`http://x/api/leads/${id}/events`, { method: 'POST', body: JSON.stringify(body) }), {
    params: { id },
  });

describe.runIf(Boolean(TEST_DATABASE_URL))('app/api/leads routes (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const createdLeadIds: string[] = [];

  async function makeClient() {
    const client = await createClient({
      name: 'API Leads Test Client',
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

  async function makeLead(body: Record<string, unknown>) {
    const res = await post(body);
    const { lead } = (await res.json()) as { lead: { id: string } };
    createdLeadIds.push(lead.id);
    return lead;
  }

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

  afterAll(async () => {
    await closePool();
  });

  it('POST creates an internal lead (201) with its initial event', async () => {
    const res = await post({ scope: 'internal', name: 'Route Internal Lead' });
    expect(res.status).toBe(201);
    const { lead, event } = (await res.json()) as { lead: { id: string; clientId: null }; event: { type: string } };
    createdLeadIds.push(lead.id);
    expect(lead.clientId).toBeNull();
    expect(event.type).toBe('lead_received');
  });

  it('POST 422s when scope is "client" but the clientId does not exist', async () => {
    const res = await post({ scope: 'client', clientId: 'client-does-not-exist', name: 'Ghost Lead' });
    expect(res.status).toBe(422);
  });

  it('POST 400s malformed input before ever reaching the repository (e.g. missing name)', async () => {
    const res = await post({ scope: 'internal' });
    expect(res.status).toBe(400);
  });

  it('GET filters by clientId and scope in SQL, excluding other clients', async () => {
    const clientA = await makeClient();
    const clientB = await makeClient();
    const leadA = await makeLead({ scope: 'client', clientId: clientA.id, name: 'Lead A' });
    await makeLead({ scope: 'client', clientId: clientB.id, name: 'Lead B' });

    const res = await list(`?clientId=${clientA.id}`);
    const { leads } = (await res.json()) as { leads: { id: string }[] };
    expect(leads.map((l) => l.id)).toEqual([leadA.id]);
  });

  it('GET /[id] 200s for a real lead and 404s an unknown one', async () => {
    const lead = await makeLead({ scope: 'internal', name: 'Findable' });
    expect((await getOne(lead.id)).status).toBe(200);
    expect((await getOne('lead-does-not-exist')).status).toBe(404);
  });

  it('PATCH updates business fields but rejects a stage field entirely (whitelist)', async () => {
    const lead = await makeLead({ scope: 'internal', name: 'Patchable' });
    const res = await patch(lead.id, { phone: '+34 600 000 000' });
    expect(res.status).toBe(200);
    const { lead: updated } = (await res.json()) as { lead: { phone: string } };
    expect(updated.phone).toBe('+34 600 000 000');

    const rejected = await patch(lead.id, { stage: 'converted' });
    expect(rejected.status).toBe(400); // unknown key under .strict()
  });

  it('POST /stage changes stage and returns the new event; repeating it appends nothing new', async () => {
    const lead = await makeLead({ scope: 'internal', name: 'Stager' });
    const res = await postStage(lead.id, 'qualified');
    expect(res.status).toBe(200);
    const { lead: updated, event } = (await res.json()) as { lead: { stage: string }; event: { type: string } };
    expect(updated.stage).toBe('qualified');
    expect(event.type).toBe('stage_changed');

    const repeat = await postStage(lead.id, 'qualified');
    const repeatBody = (await repeat.json()) as { event: null };
    expect(repeatBody.event).toBeNull();
  });

  it('GET /events returns the ordered timeline; POST /events only ever appends a manual note', async () => {
    const lead = await makeLead({ scope: 'internal', name: 'Notable' });
    const noteRes = await postEvent(lead.id, { summary: 'Called, left a voicemail' });
    expect(noteRes.status).toBe(201);
    const { event } = (await noteRes.json()) as { event: { type: string; source: string } };
    expect(event.type).toBe('manual_note');
    expect(event.source).toBe('manual');

    const eventsRes = await getEvents(lead.id);
    const { events } = (await eventsRes.json()) as { events: { type: string }[] };
    expect(events.map((e) => e.type)).toEqual(['lead_received', 'manual_note']);
  });

  it('POST /events rejects a caller-supplied type/source — the browser cannot spoof an automated event', async () => {
    const lead = await makeLead({ scope: 'internal', name: 'No Spoofing' });
    const res = await postEvent(lead.id, { summary: 'x', type: 'converted', source: 'system' });
    expect(res.status).toBe(400); // unknown keys under .strict()
  });
});

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { appendCommercialEvent, createLead } from '@/lib/server/leads-repo';
import { GET as GET_RESULTS } from '@/app/api/results/route';
import { GET as GET_HOME } from '@/app/api/results/home/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

const getResults = (qs: string = '') => GET_RESULTS(new Request(`http://x/api/results${qs}`));
const getHome = (qs: string = '') => GET_HOME(new Request(`http://x/api/results/home${qs}`));

describe.runIf(Boolean(TEST_DATABASE_URL))('app/api/results routes (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const createdLeadIds: string[] = [];

  async function makeClient() {
    const client = await createClient({
      name: 'API Results Test Client',
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

  async function makeLead(input: Parameters<typeof createLead>[0]) {
    const { lead } = await createLead(input);
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

  it('GET /api/results 200s with a real funnel for a scoped client', async () => {
    const client = await makeClient();
    const lead = await makeLead({ scope: 'client', clientId: client.id, name: 'Route Lead' });
    await appendCommercialEvent({ leadId: lead.id, type: 'converted', source: 'manual', summary: 'x', conversionValue: 250 });

    const res = await getResults(`?clientId=${client.id}&preset=all`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overall.funnel.leads).toBe(1);
    expect(body.overall.funnel.converted).toBe(1);
    expect(body.overall.value.total).toBe(250);
  });

  it('GET /api/results excludes another client’s leads when clientId is given', async () => {
    const clientA = await makeClient();
    const clientB = await makeClient();
    await makeLead({ scope: 'client', clientId: clientA.id, name: 'A' });
    await makeLead({ scope: 'client', clientId: clientB.id, name: 'B' });

    const res = await getResults(`?clientId=${clientA.id}`);
    const body = await res.json();
    expect(body.overall.funnel.leads).toBe(1);
  });

  it('GET /api/results 400s on an invalid preset', async () => {
    const res = await getResults('?preset=not_a_real_preset');
    expect(res.status).toBe(400);
  });

  it('GET /api/results never includes an ad-spend/ROAS/CAC/Meta field — no live source in V1', async () => {
    const res = await getResults('?preset=all');
    const body = await res.json();
    const keys = Object.keys(body.overall);
    expect(keys).not.toContain('adSpend');
    expect(keys).not.toContain('roas');
    expect(keys).not.toContain('cac');
    expect(keys).not.toContain('metaLeads');
    expect(JSON.stringify(body)).not.toMatch(/meta_api|metaAds|meta_ads/i);
  });

  it('GET /api/results/home 200s with the expected operational widget keys', async () => {
    const res = await getHome();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('recentLeads');
    expect(body).toHaveProperty('highPriorityLeads');
    expect(body).toHaveProperty('awaitingFirstContact');
    expect(body).toHaveProperty('upcomingAppointments');
    expect(body).toHaveProperty('recentConversions');
    expect(body).toHaveProperty('recentActivity');
    expect(body).toHaveProperty('valueGenerated');
    expect(body).toHaveProperty('clientSnapshot');
  });

  it('GET /api/results/home respects a custom limit', async () => {
    const client = await makeClient();
    for (let i = 0; i < 3; i += 1) {
      await makeLead({ scope: 'client', clientId: client.id, name: `Limit Lead ${i}` });
    }
    const res = await getHome('?limit=2');
    const body = await res.json();
    expect(body.recentLeads.length).toBeLessThanOrEqual(2);
  });

  it('GET /api/results/home 400s on a malformed limit', async () => {
    const res = await getHome('?limit=not-a-number');
    expect(res.status).toBe(400);
  });
});

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { ingestLeadTransactional } from '@/lib/server/leads-repo';
import { GET } from '@/app/api/ops/status/client/[clientId]/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('GET /api/ops/status/client/[clientId] (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const createdLeadIds: string[] = [];

  async function makeClient() {
    const client = await createClient({
      name: 'API Client Ops Status Test Client',
      sector: 'Testing',
      status: 'prospect',
      service: 'API client ops status fixture',
      metaBudgetMonthly: 0,
      startDate: '2026-01-01',
      owner: 'test-suite',
    });
    createdClientIds.push(client.id);
    return client;
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

  it('200s with the client-scoped snapshot shape (no "clients" evidence list, no model field)', async () => {
    const client = await makeClient();
    const res = await GET(new Request('http://localhost/api/ops/status/client/' + client.id), {
      params: { clientId: client.id },
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.automations)).toBe(true);
    expect(body.automations.map((a: { id: string }) => a.id).sort()).toEqual(
      ['commercial_lifecycle', 'lead_intake', 'lead_qualification', 'whatsapp_inbound', 'whatsapp_outbound'].sort(),
    );
    for (const automation of body.automations) {
      expect(automation.clients).toBeUndefined();
    }
    expect(body.agent).toBeDefined();
    expect(body.agent.id).toBe('lead_qualification_agent');
    expect(body.agent.clients).toBeUndefined();
    expect(body.agent.model).toBeUndefined();
  });

  it('reflects real evidence for this specific client id', async () => {
    const client = await makeClient();
    const result = await ingestLeadTransactional({
      scope: 'client',
      clientId: client.id,
      name: 'API Route Evidence Lead',
      deliveryId: `delivery-${Date.now()}-api`,
      ingestionSource: 'meta',
      externalLeadId: `meta-api-${Date.now()}`,
    });
    createdLeadIds.push(result.lead.id);

    const res = await GET(new Request('http://localhost/api/ops/status/client/' + client.id), {
      params: { clientId: client.id },
    });
    const body = await res.json();
    const leadIntake = body.automations.find((a: { id: string }) => a.id === 'lead_intake');
    expect(leadIntake.status).toBe('activity_observed');
  });

  it('an unknown/garbage client id resolves to a neutral all-quiet snapshot, never an error', async () => {
    const res = await GET(new Request('http://localhost/api/ops/status/client/00000000-0000-0000-0000-000000000000'), {
      params: { clientId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const automation of body.automations) {
      expect(automation.status).not.toBe('needs_attention');
    }
  });

  it('never returns DATABASE_URL, API keys, or any other secret value', async () => {
    const client = await makeClient();
    const res = await GET(new Request('http://localhost/api/ops/status/client/' + client.id), {
      params: { clientId: client.id },
    });
    const raw = await res.text();

    expect(raw).not.toContain(TEST_DATABASE_URL);
    expect(raw).not.toMatch(/postgres(ql)?:\/\//i);
    if (process.env.INGEST_API_KEY) expect(raw).not.toContain(process.env.INGEST_API_KEY);
    if (process.env.MAKE_EVENTS_API_KEY) expect(raw).not.toContain(process.env.MAKE_EVENTS_API_KEY);
    expect(raw.toLowerCase()).not.toContain('"database_url"');
  });
});

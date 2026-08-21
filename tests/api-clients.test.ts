import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { DELETE, GET as GET_ONE, PATCH } from '@/app/api/clients/[id]/route';
import { GET, POST } from '@/app/api/clients/route';
import { createLead } from '@/lib/server/leads-repo';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

const post = (body: unknown) => POST(new Request('http://x/api/clients', { method: 'POST', body: JSON.stringify(body) }));
const patch = (id: string, body: unknown) =>
  PATCH(new Request(`http://x/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: { id } });
const getOne = (id: string) => GET_ONE(new Request(`http://x/api/clients/${id}`), { params: { id } });
const del = (id: string) => DELETE(new Request(`http://x/api/clients/${id}`, { method: 'DELETE' }), { params: { id } });

const validClientBody = {
  name: 'API Test Client',
  sector: 'Testing',
  status: 'prospect',
  service: 'Route test fixture',
  metaBudgetMonthly: 0,
  startDate: '2026-01-01',
  owner: 'test-suite',
};

describe.runIf(Boolean(TEST_DATABASE_URL))('app/api/clients routes (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];

  async function makeClient(overrides: Record<string, unknown> = {}) {
    const res = await post({ ...validClientBody, ...overrides });
    const { client } = (await res.json()) as { client: { id: string } };
    createdClientIds.push(client.id);
    return client;
  }

  afterEach(async () => {
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE client_id = $1)', [id]);
      await query('DELETE FROM leads WHERE client_id = $1', [id]);
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    await closePool();
  });

  it('POST creates a client (201)', async () => {
    const res = await post(validClientBody);
    expect(res.status).toBe(201);
    const { client } = (await res.json()) as { client: { id: string; name: string } };
    createdClientIds.push(client.id);
    expect(client.name).toBe('API Test Client');
  });

  it('POST 400s on an invalid status enum, never touching the DB', async () => {
    const res = await post({ ...validClientBody, status: 'not_a_status' });
    expect(res.status).toBe(400);
  });

  it('POST 400s on an unknown extra field (whitelist enforced)', async () => {
    const res = await post({ ...validClientBody, notARealField: 'x' });
    expect(res.status).toBe(400);
  });

  it('GET lists what was created', async () => {
    const client = await makeClient();
    const { clients } = (await (await GET()).json()) as { clients: { id: string }[] };
    expect(clients.map((c) => c.id)).toContain(client.id);
  });

  it('GET /[id] returns 200 for a real id and 404 for an unknown one', async () => {
    const client = await makeClient();
    expect((await getOne(client.id)).status).toBe(200);
    expect((await getOne('client-does-not-exist')).status).toBe(404);
  });

  it('PATCH updates whitelisted fields and 404s on an unknown id', async () => {
    const client = await makeClient();
    const res = await patch(client.id, { status: 'active' });
    expect(res.status).toBe(200);
    const { client: updated } = (await res.json()) as { client: { status: string } };
    expect(updated.status).toBe('active');

    expect((await patch('client-does-not-exist', { status: 'active' })).status).toBe(404);
  });

  it('DELETE removes a client with zero leads (200) and 404s an unknown id', async () => {
    const client = await makeClient();
    expect((await del(client.id)).status).toBe(200);
    expect((await getOne(client.id)).status).toBe(404);
    expect((await del('client-does-not-exist')).status).toBe(404);
  });

  it('DELETE 409s (with a lead count) when the client still has leads, never leaking a raw DB error', async () => {
    const client = await makeClient();
    await createLead({ scope: 'client', clientId: client.id, name: 'Blocking Lead' });

    const res = await del(client.id);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; leadCount: number };
    expect(body.leadCount).toBe(1);
    expect(body.error).not.toMatch(/postgres|pg_|constraint|relation/i);
  });
});

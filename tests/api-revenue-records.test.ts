import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { GET, POST } from '@/app/api/revenue-records/route';
import { PATCH } from '@/app/api/revenue-records/[id]/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

const getRevenueRecords = (qs: string = '') => GET(new Request(`http://x/api/revenue-records${qs}`));
const postRevenueRecord = (body: unknown) =>
  POST(new Request('http://x/api/revenue-records', { method: 'POST', body: JSON.stringify(body) }));
const patchRevenueRecord = (id: string, body: unknown) =>
  PATCH(new Request(`http://x/api/revenue-records/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: { id },
  });

describe.runIf(Boolean(TEST_DATABASE_URL))('app/api/revenue-records routes (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];

  async function makeClient() {
    const client = await createClient({
      name: 'API Revenue Records Test Client',
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

  afterEach(async () => {
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM revenue_records WHERE client_id = $1', [id]);
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    await closePool();
  });

  // tests/setup.ts mocks lib/server/auth.ts to resolve as an internal user by
  // default — these routes exercise the resulting internal-role behavior.
  // The real, unmocked 401 boundary (no session at all) is covered by
  // tests/api-internal-protection.test.ts.

  it('GET /api/revenue-records 400s when clientId is omitted', async () => {
    const res = await getRevenueRecords();
    expect(res.status).toBe(400);
  });

  it('POST creates a manual revenue record and GET returns it scoped to its client', async () => {
    const client = await makeClient();

    const postRes = await postRevenueRecord({
      clientId: client.id,
      amount: 1200,
      occurredAt: '2026-08-01T00:00:00.000Z',
      notes: 'Pago inicial',
    });
    expect(postRes.status).toBe(201);
    const { record } = await postRes.json();
    expect(record.clientId).toBe(client.id);
    expect(record.amount).toBe(1200);
    expect(record.source).toBe('manual');
    expect(record.dataSource).toBe('manual');

    const getRes = await getRevenueRecords(`?clientId=${client.id}`);
    expect(getRes.status).toBe(200);
    const { records } = await getRes.json();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(record.id);
  });

  it('POST 400s on an invalid body (non-positive amount)', async () => {
    const client = await makeClient();
    const res = await postRevenueRecord({ clientId: client.id, amount: 0, occurredAt: '2026-08-01T00:00:00.000Z' });
    expect(res.status).toBe(400);
  });

  it('POST 400s on an unrecognized field (strict schema)', async () => {
    const client = await makeClient();
    const res = await postRevenueRecord({
      clientId: client.id,
      amount: 100,
      occurredAt: '2026-08-01T00:00:00.000Z',
      dataSource: 'demo',
    });
    expect(res.status).toBe(400);
  });

  it('POST 422s on a missing client id', async () => {
    const res = await postRevenueRecord({ clientId: 'client-does-not-exist', amount: 100, occurredAt: '2026-08-01T00:00:00.000Z' });
    expect(res.status).toBe(422);
  });

  it('PATCH updates an existing record', async () => {
    const client = await makeClient();
    const created = await (
      await postRevenueRecord({ clientId: client.id, amount: 100, occurredAt: '2026-08-01T00:00:00.000Z' })
    ).json();

    const res = await patchRevenueRecord(created.record.id, { amount: 500 });
    expect(res.status).toBe(200);
    const { record } = await res.json();
    expect(record.amount).toBe(500);
  });

  it('PATCH 404s on an unknown id', async () => {
    const res = await patchRevenueRecord('revenue-does-not-exist', { amount: 50 });
    expect(res.status).toBe(404);
  });

  it('PATCH ignores caller-supplied audit/source fields (strict schema rejects them)', async () => {
    const client = await makeClient();
    const created = await (
      await postRevenueRecord({ clientId: client.id, amount: 100, occurredAt: '2026-08-01T00:00:00.000Z' })
    ).json();

    const res = await patchRevenueRecord(created.record.id, { amount: 200, createdBy: 'attacker-controlled-id' });
    expect(res.status).toBe(400);
  });
});

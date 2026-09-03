import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { GET, POST } from '@/app/api/whatsapp/numbers/route';
import { PATCH } from '@/app/api/whatsapp/numbers/[id]/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('WhatsApp business number admin API', () => {
  const createdNumberIds: string[] = [];
  const createdClientIds: string[] = [];

  afterEach(async () => {
    if (createdNumberIds.length > 0) {
      await query('DELETE FROM whatsapp_business_numbers WHERE id = ANY($1)', [createdNumberIds.splice(0)]);
    }
    if (createdClientIds.length > 0) {
      await query('DELETE FROM clients WHERE id = ANY($1)', [createdClientIds.splice(0)]);
    }
  });

  afterAll(async () => {
    await closePool();
  });

  async function post(body: unknown) {
    return POST(
      new Request('http://x/api/whatsapp/numbers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  }

  it('creates and lists an internal mapping without a fake client', async () => {
    const created = await post({
      ownerScope: 'internal',
      phoneNumberId: '300000000001',
      wabaId: '400000000001',
      label: 'REKREATIVE',
      validFrom: '2026-01-01T00:00:00.000Z',
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    createdNumberIds.push(body.number.id);
    expect(body.number).toMatchObject({ ownerScope: 'internal', clientId: null });

    const listed = await GET(new Request('http://x/api/whatsapp/numbers?ownerScope=internal'));
    expect(listed.status).toBe(200);
    expect((await listed.json()).numbers.some((number: { id: string }) => number.id === body.number.id)).toBe(true);
  });

  it('creates a client mapping and keeps ownership immutable on PATCH', async () => {
    const client = await createClient({
      name: 'WhatsApp API Client',
      sector: 'Test',
      status: 'active',
      service: 'Test',
      metaBudgetMonthly: 0,
      startDate: '2026-09-01',
      owner: 'Test',
    });
    createdClientIds.push(client.id);
    const created = await post({
      ownerScope: 'client',
      clientId: client.id,
      phoneNumberId: '300000000002',
      validFrom: '2026-01-01T00:00:00.000Z',
    });
    const body = await created.json();
    createdNumberIds.push(body.number.id);

    const patched = await PATCH(
      new Request(`http://x/api/whatsapp/numbers/${body.number.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Principal', validTo: '2026-12-01T00:00:00.000Z' }),
      }),
      { params: { id: body.number.id } },
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).number).toMatchObject({
      ownerScope: 'client',
      clientId: client.id,
      phoneNumberId: '300000000002',
      label: 'Principal',
    });
  });

  it('rejects invalid ownership and overlapping Phone Number ID mappings', async () => {
    expect((await post({ ownerScope: 'client', phoneNumberId: '300000000003' })).status).toBe(400);

    const first = await post({
      ownerScope: 'internal',
      phoneNumberId: '300000000004',
      validFrom: '2026-01-01T00:00:00.000Z',
    });
    const firstBody = await first.json();
    createdNumberIds.push(firstBody.number.id);
    const overlapping = await post({
      ownerScope: 'internal',
      phoneNumberId: '300000000004',
      validFrom: '2026-02-01T00:00:00.000Z',
    });
    expect(overlapping.status).toBe(422);
  });
});

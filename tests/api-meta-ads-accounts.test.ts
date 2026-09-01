import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { GET as GET_LIST, POST as CREATE } from '@/app/api/meta-ads/accounts/route';
import { PATCH } from '@/app/api/meta-ads/accounts/[id]/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('/api/meta-ads/accounts (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const createdMetaAccountIds: string[] = [];
  const rand = () => Math.random().toString(36).slice(2);

  async function makeClient() {
    const client = await createClient({
      name: 'Meta Accounts API Test Client',
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
    for (const metaAdAccountId of createdMetaAccountIds.splice(0)) {
      await query('DELETE FROM client_meta_accounts WHERE meta_ad_account_id = $1', [metaAdAccountId]);
    }
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM client_meta_accounts WHERE client_id = $1', [id]);
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    await closePool();
  });

  function post(body: unknown) {
    return CREATE(new Request('http://x/api/meta-ads/accounts', { method: 'POST', body: JSON.stringify(body) }));
  }

  function list(qs = '') {
    return GET_LIST(new Request(`http://x/api/meta-ads/accounts${qs}`));
  }

  function patch(id: string, body: unknown) {
    return PATCH(new Request(`http://x/api/meta-ads/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: { id } });
  }

  it('creates a mapping and 201s with the created row', async () => {
    const client = await makeClient();
    const res = await post({ clientId: client.id, metaAdAccountId: `act_${rand()}`, label: 'Cuenta principal' });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.account.clientId).toBe(client.id);
    expect(json.account.label).toBe('Cuenta principal');
  });

  it('creates and lists an internal mapping without a client row', async () => {
    const accountId = `act_internal_${rand()}`;
    createdMetaAccountIds.push(accountId);
    const created = await post({ ownerScope: 'internal', clientId: null, metaAdAccountId: accountId, label: 'REKREATIVE' });
    expect(created.status).toBe(201);
    expect((await created.json()).account).toMatchObject({ ownerScope: 'internal', clientId: null, metaAdAccountId: accountId });

    const response = await list('?ownerScope=internal');
    const json = await response.json();
    expect(json.accounts.some((item: { metaAdAccountId: string }) => item.metaAdAccountId === accountId)).toBe(true);
    expect(json.accounts.every((item: { ownerScope: string }) => item.ownerScope === 'internal')).toBe(true);
  });

  it('rejects overlapping ownership intervals for the same canonical account', async () => {
    const client = await makeClient();
    const accountId = `act_overlap_${rand()}`;
    createdMetaAccountIds.push(accountId);
    expect((await post({ ownerScope: 'internal', clientId: null, metaAdAccountId: accountId, validFrom: '2026-01-01' })).status).toBe(201);

    const conflict = await post({ ownerScope: 'client', clientId: client.id, metaAdAccountId: accountId, validFrom: '2026-07-01' });
    expect(conflict.status).toBe(422);
  });

  it('400s on a missing metaAdAccountId', async () => {
    const client = await makeClient();
    expect((await post({ clientId: client.id })).status).toBe(400);
  });

  it('422s on an unknown client', async () => {
    expect((await post({ clientId: 'client-does-not-exist', metaAdAccountId: `act_${rand()}` })).status).toBe(422);
  });

  it('422s when the ad account is already actively mapped to another client', async () => {
    const clientA = await makeClient();
    const clientB = await makeClient();
    const accountId = `act_${rand()}`;
    await post({ clientId: clientA.id, metaAdAccountId: accountId });
    const res = await post({ clientId: clientB.id, metaAdAccountId: accountId });
    expect(res.status).toBe(422);
  });

  it('GET without clientId lists every mapping; GET with clientId scopes to one client', async () => {
    const clientA = await makeClient();
    const clientB = await makeClient();
    await post({ clientId: clientA.id, metaAdAccountId: `act_${rand()}` });
    await post({ clientId: clientB.id, metaAdAccountId: `act_${rand()}` });

    const scoped = await list(`?clientId=${clientA.id}`);
    const scopedJson = await scoped.json();
    expect(scopedJson.accounts).toHaveLength(1);
    expect(scopedJson.accounts[0].clientId).toBe(clientA.id);

    const all = await list();
    const allJson = await all.json();
    const ids = allJson.accounts.map((a: { clientId: string }) => a.clientId);
    expect(ids).toContain(clientA.id);
    expect(ids).toContain(clientB.id);
  });

  it('PATCH updates label/active and 404s for an unknown id', async () => {
    const client = await makeClient();
    const created = await (await post({ clientId: client.id, metaAdAccountId: `act_${rand()}`, label: 'Old' })).json();

    const updated = await patch(created.account.id, { label: 'New', active: false });
    expect(updated.status).toBe(200);
    const updatedJson = await updated.json();
    expect(updatedJson.account.label).toBe('New');
    expect(updatedJson.account.active).toBe(false);

    expect((await patch('does-not-exist', { label: 'X' })).status).toBe(404);
  });

  it('never leaks DATABASE_URL or any secret in a response', async () => {
    const client = await makeClient();
    const res = await post({ clientId: client.id, metaAdAccountId: `act_${rand()}` });
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
  });
});

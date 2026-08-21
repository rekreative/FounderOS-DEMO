import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient, deleteClient, getClientById, listClients, updateClient } from '@/lib/server/clients-repo';
import { createLead } from '@/lib/server/leads-repo';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

// Integration tests against the operator's real local dev PostgreSQL
// (rekreative_os_dev). Every row this file creates is tracked by id and
// deleted in afterEach, in FK-safe order (lead_events → leads → clients) —
// never a blanket DELETE, so the operator's own seeded/manual data is never
// touched. Skips cleanly when no DATABASE_URL is configured.
const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('lib/server/clients-repo (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];

  const testClientInput = (overrides: Partial<Parameters<typeof createClient>[0]> = {}) => ({
    name: 'Backend V1 Test Client',
    sector: 'Testing',
    status: 'prospect' as const,
    service: 'Repo test fixture',
    metaBudgetMonthly: 0,
    startDate: '2026-01-01',
    owner: 'test-suite',
    ...overrides,
  });

  async function makeClient(overrides: Partial<Parameters<typeof createClient>[0]> = {}) {
    const client = await createClient(testClientInput(overrides));
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

  it('creates a client and maps every column back to camelCase', async () => {
    const client = await makeClient({ name: 'Acme Test Co', metaBudgetMonthly: 1500 });
    expect(client.id).toMatch(/^client-/);
    expect(client.name).toBe('Acme Test Co');
    expect(client.metaBudgetMonthly).toBe(1500);
    expect(client.startDate).toBe('2026-01-01');
    expect(typeof client.createdAt).toBe('string');
    expect(typeof client.updatedAt).toBe('string');
  });

  it('gets a client by id, and returns null for an unknown id', async () => {
    const client = await makeClient();
    expect(await getClientById(client.id)).toEqual(client);
    expect(await getClientById('client-does-not-exist')).toBeNull();
  });

  it('lists clients including one just created', async () => {
    const client = await makeClient();
    const all = await listClients();
    expect(all.map((c) => c.id)).toContain(client.id);
  });

  it('updates only the patched fields and bumps updatedAt', async () => {
    const client = await makeClient({ status: 'prospect' });
    const updated = await updateClient(client.id, { status: 'active', owner: 'new-owner' });
    expect(updated?.status).toBe('active');
    expect(updated?.owner).toBe('new-owner');
    expect(updated?.name).toBe(client.name); // untouched field preserved
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(client.updatedAt).getTime());
  });

  it('returns null updating an unknown client', async () => {
    expect(await updateClient('client-does-not-exist', { owner: 'x' })).toBeNull();
  });

  it('deletes a client with zero leads', async () => {
    const client = await makeClient();
    const result = await deleteClient(client.id);
    expect(result).toEqual({ outcome: 'deleted' });
    expect(await getClientById(client.id)).toBeNull();
    // already gone — afterEach's own delete is a safe no-op
  });

  it('reports not_found deleting an id that never existed', async () => {
    expect(await deleteClient('client-does-not-exist')).toEqual({ outcome: 'not_found' });
  });

  it('blocks deletion (409-shaped result) when the client still has leads, and never touches them', async () => {
    const client = await makeClient();
    await createLead({ scope: 'client', clientId: client.id, name: 'Blocking Lead' });

    const result = await deleteClient(client.id);
    expect(result).toEqual({ outcome: 'blocked', leadCount: 1 });

    // Not cascaded, not nulled — the client and its lead are both still there.
    expect(await getClientById(client.id)).not.toBeNull();
    const leads = await query('SELECT client_id FROM leads WHERE client_id = $1', [client.id]);
    expect(leads.rowCount).toBe(1);
  });
});

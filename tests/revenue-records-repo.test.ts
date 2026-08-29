import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import {
  createRevenueRecord,
  getRevenueRecordById,
  listRevenueRecords,
  RevenueRecordValidationError,
  updateRevenueRecord,
} from '@/lib/server/revenue-records-repo';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

// Integration tests against a real Postgres test database (see
// tests/helpers/pg-test-env.ts - requires an explicit TEST_DATABASE_URL,
// never DATABASE_URL/.env.local, which may be production) - exercises
// Results Manual Revenue V1's repository layer end to end. Skips cleanly
// when no TEST_DATABASE_URL is configured.
const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('lib/server/revenue-records-repo (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];

  async function makeClient(overrides: Partial<Parameters<typeof createClient>[0]> = {}) {
    const client = await createClient({
      name: 'Revenue Records Repo Test Client',
      sector: 'Testing',
      status: 'prospect',
      service: 'Repo test fixture',
      metaBudgetMonthly: 0,
      startDate: '2026-01-01',
      owner: 'test-suite',
      ...overrides,
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

  describe('createRevenueRecord', () => {
    it('creates a manual revenue record, always writing source/dataSource system-controlled values', async () => {
      const client = await makeClient();
      const record = await createRevenueRecord({
        clientId: client.id,
        amount: 2500,
        occurredAt: '2026-08-01T00:00:00.000Z',
        notes: 'Pago inicial',
        createdBy: null,
      });

      expect(record.clientId).toBe(client.id);
      expect(record.amount).toBe(2500);
      expect(record.source).toBe('manual');
      expect(record.externalRef).toBeNull();
      expect(record.dataSource).toBe('manual');
      expect(record.notes).toBe('Pago inicial');
      expect(record.createdBy).toBeNull();
      expect(record.updatedBy).toBeNull();
    });

    it('trims notes, storing null for an empty/whitespace-only value', async () => {
      const client = await makeClient();
      const record = await createRevenueRecord({
        clientId: client.id,
        amount: 100,
        occurredAt: '2026-08-01T00:00:00.000Z',
        notes: '   ',
        createdBy: null,
      });
      expect(record.notes).toBeNull();
    });

    it('rejects a missing client id with a RevenueRecordValidationError (CLIENT_NOT_FOUND)', async () => {
      await expect(
        createRevenueRecord({
          clientId: 'client-does-not-exist',
          amount: 100,
          occurredAt: '2026-08-01T00:00:00.000Z',
          createdBy: null,
        }),
      ).rejects.toBeInstanceOf(RevenueRecordValidationError);
    });

    it('rejects a non-positive amount at the DB CHECK constraint', async () => {
      const client = await makeClient();
      await expect(
        createRevenueRecord({
          clientId: client.id,
          amount: 0,
          occurredAt: '2026-08-01T00:00:00.000Z',
          createdBy: null,
        }),
      ).rejects.toThrow();
    });
  });

  describe('listRevenueRecords', () => {
    it('scopes strictly by clientId and orders newest occurredAt first', async () => {
      const clientA = await makeClient();
      const clientB = await makeClient();
      await createRevenueRecord({ clientId: clientA.id, amount: 100, occurredAt: '2026-08-01T00:00:00.000Z', createdBy: null });
      await createRevenueRecord({ clientId: clientA.id, amount: 200, occurredAt: '2026-08-15T00:00:00.000Z', createdBy: null });
      await createRevenueRecord({ clientId: clientB.id, amount: 999, occurredAt: '2026-08-10T00:00:00.000Z', createdBy: null });

      const records = await listRevenueRecords(clientA.id);
      expect(records).toHaveLength(2);
      expect(records[0].amount).toBe(200);
      expect(records[1].amount).toBe(100);
      expect(records.every((r) => r.clientId === clientA.id)).toBe(true);
    });

    it('returns an empty array for a client with no revenue records', async () => {
      const client = await makeClient();
      expect(await listRevenueRecords(client.id)).toEqual([]);
    });
  });

  describe('updateRevenueRecord', () => {
    it('patches amount/occurredAt/notes and bumps updatedAt/updatedBy', async () => {
      const client = await makeClient();
      const created = await createRevenueRecord({
        clientId: client.id,
        amount: 100,
        occurredAt: '2026-08-01T00:00:00.000Z',
        createdBy: null,
      });

      const updated = await updateRevenueRecord(created.id, {
        amount: 350,
        notes: 'Ajustado',
        updatedBy: null,
      });

      expect(updated?.amount).toBe(350);
      expect(updated?.notes).toBe('Ajustado');
      expect(updated?.occurredAt).toBe(created.occurredAt);
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());
    });

    it('returns null for an unknown id', async () => {
      expect(await updateRevenueRecord('revenue-does-not-exist', { amount: 50, updatedBy: null })).toBeNull();
    });

    it('rejects moving a record to a missing client id', async () => {
      const client = await makeClient();
      const created = await createRevenueRecord({
        clientId: client.id,
        amount: 100,
        occurredAt: '2026-08-01T00:00:00.000Z',
        createdBy: null,
      });

      await expect(
        updateRevenueRecord(created.id, { clientId: 'client-does-not-exist', updatedBy: null }),
      ).rejects.toBeInstanceOf(RevenueRecordValidationError);
    });
  });

  describe('getRevenueRecordById', () => {
    it('returns null for an unknown id', async () => {
      expect(await getRevenueRecordById('revenue-does-not-exist')).toBeNull();
    });
  });
});

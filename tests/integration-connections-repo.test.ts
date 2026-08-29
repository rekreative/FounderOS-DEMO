import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import {
  archiveIntegrationConnection,
  createIntegrationConnection,
  getIntegrationConnectionById,
  IntegrationConnectionValidationError,
  listIntegrationConnections,
  markIntegrationConnectionFailed,
  markIntegrationConnectionVerified,
  resetIntegrationConnectionVerification,
  restoreIntegrationConnection,
  updateIntegrationConnection,
} from '@/lib/server/integration-connections-repo';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

// Integration tests against a real Postgres test database (see
// tests/helpers/pg-test-env.ts - requires an explicit TEST_DATABASE_URL,
// never DATABASE_URL/.env.local, which may be production) - exercises
// Connections/Secrets V1's repository layer end to end. Skips cleanly
// when no TEST_DATABASE_URL is configured.
// Requires migration 0008_integration_connections.sql to already be applied.
const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('lib/server/integration-connections-repo (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  // Every connection this file creates is tracked by its OWN id, the instant
  // createConnection() (below) resolves — the only ownership signal that
  // survives whatever a test does to the row afterward (updateIntegrationConnection
  // clearing client_id on a scope change, archive/restore leaving audit ids
  // null, etc.). This is what afterEach deletes by.
  const createdConnectionIds: string[] = [];
  // integration_connections.created_by/updated_by are a real UUID FK to
  // profiles(user_id) (profiles.user_id itself FKs to auth.users(id)) — a
  // fake string like 'user-1' fails with "invalid input syntax for type
  // uuid". Two disposable audit users, created once for the whole file and
  // torn down in afterAll, same fixture shape as
  // tests/knowledge-entries-repo.test.ts's makeProfileUser.
  const createdAuthUserIds: string[] = [];

  /** Every test in this file creates connections through this wrapper
   *  instead of calling createIntegrationConnection directly, so
   *  createdConnectionIds always has a complete, accurate record of what to
   *  clean up — no call site can forget. */
  async function createConnection(...args: Parameters<typeof createIntegrationConnection>) {
    const connection = await createIntegrationConnection(...args);
    createdConnectionIds.push(connection.id);
    return connection;
  }

  async function makeProfileUser(role: 'internal' | 'client' = 'internal'): Promise<string> {
    const id = randomUUID();
    await query('INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES ($1, false, false)', [id]);
    await query('INSERT INTO profiles (user_id, role) VALUES ($1, $2)', [id, role]);
    createdAuthUserIds.push(id);
    return id;
  }

  let userA: string;
  let userB: string;

  beforeAll(async () => {
    userA = await makeProfileUser();
    userB = await makeProfileUser();
  });

  async function makeClient(overrides: Partial<Parameters<typeof createClient>[0]> = {}) {
    const client = await createClient({
      name: 'Integration Connections Repo Test Client',
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
    // Primary cleanup: every connection this test created, by its own id.
    if (createdConnectionIds.length > 0) {
      await query('DELETE FROM integration_connections WHERE id = ANY($1)', [createdConnectionIds.splice(0)]);
    }
    // Clients must go after connections above (integration_connections.client_id
    // is ON DELETE RESTRICT).
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    // Defensive backstop only — the per-test id-based sweep above is what
    // actually guarantees zero leftover rows; this catches the case of some
    // future test in this file creating a connection through a path other
    // than the tracked createConnection() helper.
    await query('DELETE FROM integration_connections WHERE created_by = ANY($1) OR updated_by = ANY($1)', [createdAuthUserIds]);
    for (const id of createdAuthUserIds.splice(0)) {
      await query('DELETE FROM profiles WHERE user_id = $1', [id]);
      await query('DELETE FROM auth.users WHERE id = $1', [id]);
    }
    await closePool();
  });

  describe('createIntegrationConnection', () => {
    it('creates an internal connection with clientId forced to null, dataSource manual, status active, not_verified', async () => {
      const connection = await createConnection({
        scope: 'internal',
        platform: 'make',
        name: 'Make — Workspace REKREATIVE',
        createdBy: userA,
      });

      expect(connection.scope).toBe('internal');
      expect(connection.clientId).toBeNull();
      expect(connection.dataSource).toBe('manual');
      expect(connection.status).toBe('active');
      expect(connection.verificationStatus).toBe('not_verified');
      expect(connection.verificationMethod).toBeNull();
      expect(connection.lastVerifiedAt).toBeNull();
      expect(connection.createdBy).toBe(userA);
      expect(connection.updatedBy).toBe(userA);
      expect(connection.id).toMatch(/^connection-/);
    });

    it('creates a client connection for a real client', async () => {
      const client = await makeClient();
      const connection = await createConnection({
        scope: 'client',
        clientId: client.id,
        platform: 'meta',
        name: 'Meta Ads — Test Client',
        externalRef: 'act_123',
        externalLabel: 'Test ad account',
        notes: 'Fixture note',
        createdBy: null,
      });

      expect(connection.clientId).toBe(client.id);
      expect(connection.externalRef).toBe('act_123');
      expect(connection.externalLabel).toBe('Test ad account');
      expect(connection.notes).toBe('Fixture note');
      expect(connection.createdBy).toBeNull();
    });

    it('rejects a client-scoped connection with no clientId (CLIENT_ID_REQUIRED)', async () => {
      await expect(
        createIntegrationConnection({
          scope: 'client',
          platform: 'whatsapp',
          name: 'No client',
          createdBy: null,
        }),
      ).rejects.toMatchObject({ code: 'CLIENT_ID_REQUIRED' } satisfies Partial<IntegrationConnectionValidationError>);
    });

    it('rejects a client-scoped connection for a missing client id (CLIENT_NOT_FOUND) — validated against the real clients table', async () => {
      await expect(
        createIntegrationConnection({
          scope: 'client',
          clientId: 'client-does-not-exist',
          platform: 'whatsapp',
          name: 'Ghost client',
          createdBy: null,
        }),
      ).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
    });
  });

  describe('listIntegrationConnections', () => {
    it('defaults to active status, newest updated_at first', async () => {
      const first = await createConnection({ scope: 'internal', platform: 'make', name: 'First', createdBy: null });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await createConnection({ scope: 'internal', platform: 'openai', name: 'Second', createdBy: null });

      const all = await listIntegrationConnections();
      const ids = all.map((c) => c.id);
      expect(ids).toContain(first.id);
      expect(ids).toContain(second.id);
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id)); // newest first
      expect(all.every((c) => c.status === 'active')).toBe(true);
    });

    it('with a clientId returns only that client connections, never internal, never another client', async () => {
      const clientA = await makeClient();
      const clientB = await makeClient();

      const internalConnection = await createConnection({ scope: 'internal', platform: 'make', name: 'Internal', createdBy: null });
      const aConnection = await createConnection({ scope: 'client', clientId: clientA.id, platform: 'meta', name: 'A connection', createdBy: null });
      const bConnection = await createConnection({ scope: 'client', clientId: clientB.id, platform: 'meta', name: 'B connection', createdBy: null });

      const aOnly = await listIntegrationConnections({ clientId: clientA.id });
      const ids = aOnly.map((c) => c.id);
      expect(ids).toContain(aConnection.id);
      expect(ids).not.toContain(bConnection.id);
      expect(ids).not.toContain(internalConnection.id);
    });

    it('status=archived returns only archived records; active listing never includes them', async () => {
      const connection = await createConnection({ scope: 'internal', platform: 'stripe', name: 'To archive', createdBy: null });
      await archiveIntegrationConnection(connection.id, null);

      const active = await listIntegrationConnections();
      expect(active.some((c) => c.id === connection.id)).toBe(false);

      const archived = await listIntegrationConnections({ status: 'archived' });
      expect(archived.some((c) => c.id === connection.id)).toBe(true);
    });
  });

  describe('updateIntegrationConnection', () => {
    it('updates business fields, sets updatedBy, and bumps updatedAt', async () => {
      const connection = await createConnection({ scope: 'internal', platform: 'openai', name: 'Original', createdBy: userA });
      await new Promise((resolve) => setTimeout(resolve, 5));

      const updated = await updateIntegrationConnection(connection.id, { name: 'Updated name', updatedBy: userB });
      expect(updated?.name).toBe('Updated name');
      expect(updated?.updatedBy).toBe(userB);
      expect(updated?.createdBy).toBe(userA); // untouched
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThan(new Date(connection.updatedAt).getTime());
    });

    it('changing scope from client to internal clears clientId server-side, even without an explicit clientId in the patch', async () => {
      const client = await makeClient();
      const connection = await createConnection({ scope: 'client', clientId: client.id, platform: 'whatsapp', name: 'Client connection', createdBy: null });

      const updated = await updateIntegrationConnection(connection.id, { scope: 'internal', updatedBy: null });
      expect(updated?.scope).toBe('internal');
      expect(updated?.clientId).toBeNull();
    });

    it('switching scope to client without a valid clientId is rejected (CLIENT_ID_REQUIRED)', async () => {
      const connection = await createConnection({ scope: 'internal', platform: 'openai', name: 'Internal', createdBy: null });
      await expect(updateIntegrationConnection(connection.id, { scope: 'client', updatedBy: null })).rejects.toMatchObject({
        code: 'CLIENT_ID_REQUIRED',
      });
    });

    it('returns null for an unknown id', async () => {
      expect(await updateIntegrationConnection('connection-does-not-exist', { name: 'x', updatedBy: null })).toBeNull();
    });

    it('never touches verificationStatus/verificationMethod/lastVerifiedAt/dataSource/status (type system enforced — no such fields exist on UpdateIntegrationConnectionInput)', async () => {
      const connection = await createConnection({ scope: 'internal', platform: 'openai', name: 'Manual only', createdBy: null });
      const updated = await updateIntegrationConnection(connection.id, { name: 'Still manual', updatedBy: null });
      expect(updated?.dataSource).toBe('manual');
      expect(updated?.status).toBe('active');
      expect(updated?.verificationStatus).toBe('not_verified');
    });
  });

  describe('verification transitions', () => {
    it('markIntegrationConnectionVerified sets status verified, method manual, and a timestamp', async () => {
      const connection = await createConnection({ scope: 'internal', platform: 'openai', name: 'To verify', createdBy: null });
      const verified = await markIntegrationConnectionVerified(connection.id, userA);
      expect(verified?.verificationStatus).toBe('verified');
      expect(verified?.verificationMethod).toBe('manual');
      expect(verified?.lastVerifiedAt).not.toBeNull();
      expect(verified?.updatedBy).toBe(userA);
    });

    it('markIntegrationConnectionFailed sets status failed, method manual, and a timestamp', async () => {
      const connection = await createConnection({ scope: 'internal', platform: 'openai', name: 'To fail', createdBy: null });
      const failed = await markIntegrationConnectionFailed(connection.id, null);
      expect(failed?.verificationStatus).toBe('failed');
      expect(failed?.verificationMethod).toBe('manual');
      expect(failed?.lastVerifiedAt).not.toBeNull();
    });

    it('resetIntegrationConnectionVerification clears method and lastVerifiedAt back to not_verified', async () => {
      const connection = await createConnection({ scope: 'internal', platform: 'openai', name: 'To reset', createdBy: null });
      await markIntegrationConnectionVerified(connection.id, null);
      const reset = await resetIntegrationConnectionVerification(connection.id, userB);
      expect(reset?.verificationStatus).toBe('not_verified');
      expect(reset?.verificationMethod).toBeNull();
      expect(reset?.lastVerifiedAt).toBeNull();
      expect(reset?.updatedBy).toBe(userB);
    });

    it('the DB CHECK constraint rejects a verified row with a null method or timestamp — verified directly against SQL, not just the repo', async () => {
      const connection = await createConnection({ scope: 'internal', platform: 'openai', name: 'Constraint check', createdBy: null });
      await expect(
        query('UPDATE integration_connections SET verification_status = $1 WHERE id = $2', ['verified', connection.id]),
      ).rejects.toBeTruthy();
    });
  });

  describe('archive / restore', () => {
    it('archiveIntegrationConnection sets status to archived without deleting the row, and updates updatedBy/updatedAt', async () => {
      const connection = await createConnection({ scope: 'internal', platform: 'openai', name: 'To archive', createdBy: null });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const archived = await archiveIntegrationConnection(connection.id, userA);
      expect(archived?.status).toBe('archived');
      expect(archived?.updatedBy).toBe(userA);
      expect(new Date(archived!.updatedAt).getTime()).toBeGreaterThan(new Date(connection.updatedAt).getTime());
      expect(await getIntegrationConnectionById(connection.id)).not.toBeNull();
    });

    it('restoreIntegrationConnection sets an archived connection back to active', async () => {
      const connection = await createConnection({ scope: 'internal', platform: 'openai', name: 'To restore', createdBy: null });
      await archiveIntegrationConnection(connection.id, null);
      const restored = await restoreIntegrationConnection(connection.id, userB);
      expect(restored?.status).toBe('active');
      expect(restored?.updatedBy).toBe(userB);
    });
  });

  describe('no hard delete', () => {
    it('this repo exposes no delete function at all (module surface check)', async () => {
      const repo = await import('@/lib/server/integration-connections-repo');
      expect('deleteIntegrationConnection' in repo).toBe(false);
    });
  });
});

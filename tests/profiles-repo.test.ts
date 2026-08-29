import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient as createTestClient } from '@/lib/server/clients-repo';
import { getProfileRole, hasClientAccess } from '@/lib/server/profiles-repo';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

/**
 * Integration tests against a real Postgres test database (see
 * tests/helpers/pg-test-env.ts - requires an explicit TEST_DATABASE_URL,
 * never DATABASE_URL/.env.local, which may be production). Skips cleanly
 * when no TEST_DATABASE_URL is configured.
 *
 * Positive-path fixtures insert a minimal, disposable row directly into
 * auth.users (id, is_sso_user, is_anonymous — the only NOT NULL columns on
 * that table, confirmed against the live schema) so that profiles.user_id's
 * FK to auth.users(id) can be satisfied without SUPABASE_SERVICE_ROLE_KEY,
 * which this milestone deliberately does not have. Every row this file
 * creates is tracked and deleted in afterEach, in FK-safe order
 * (user_client_access → profiles → auth.users, then the test client) —
 * never a blanket DELETE.
 */
const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('lib/server/profiles-repo (real PostgreSQL)', () => {
  const createdAuthUserIds: string[] = [];
  const createdClientIds: string[] = [];

  async function makeAuthUser(): Promise<string> {
    const id = randomUUID();
    await query('INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES ($1, false, false)', [id]);
    createdAuthUserIds.push(id);
    return id;
  }

  async function makeProfile(role: 'internal' | 'client'): Promise<string> {
    const userId = await makeAuthUser();
    await query('INSERT INTO profiles (user_id, role) VALUES ($1, $2)', [userId, role]);
    return userId;
  }

  async function makeClient(): Promise<string> {
    const client = await createTestClient({
      name: 'Profiles Repo Test Client',
      sector: 'Testing',
      status: 'prospect',
      service: 'Repo test fixture',
      metaBudgetMonthly: 0,
      startDate: '2026-01-01',
      owner: 'test-suite',
    });
    createdClientIds.push(client.id);
    return client.id;
  }

  afterEach(async () => {
    for (const clientId of createdClientIds.splice(0)) {
      await query('DELETE FROM user_client_access WHERE client_id = $1', [clientId]);
      await query('DELETE FROM clients WHERE id = $1', [clientId]);
    }
    for (const userId of createdAuthUserIds.splice(0)) {
      await query('DELETE FROM user_client_access WHERE user_id = $1', [userId]);
      await query('DELETE FROM profiles WHERE user_id = $1', [userId]);
      await query('DELETE FROM auth.users WHERE id = $1', [userId]);
    }
  });

  afterAll(async () => {
    await closePool();
  });

  describe('getProfileRole', () => {
    it('returns null for a user with no profile row', async () => {
      expect(await getProfileRole(randomUUID())).toBeNull();
    });

    it('returns "internal" for an internal profile', async () => {
      const userId = await makeProfile('internal');
      expect(await getProfileRole(userId)).toBe('internal');
    });

    it('returns "client" for a client profile', async () => {
      const userId = await makeProfile('client');
      expect(await getProfileRole(userId)).toBe('client');
    });
  });

  describe('hasClientAccess', () => {
    it('returns false for a nonexistent user/client pair', async () => {
      expect(await hasClientAccess(randomUUID(), 'client-does-not-exist')).toBe(false);
    });

    it('returns false when the user has a profile but no access grant for this client', async () => {
      const userId = await makeProfile('client');
      const clientId = await makeClient();
      expect(await hasClientAccess(userId, clientId)).toBe(false);
    });

    it('returns true when a matching user_client_access row exists', async () => {
      const userId = await makeProfile('client');
      const clientId = await makeClient();
      await query('INSERT INTO user_client_access (user_id, client_id) VALUES ($1, $2)', [userId, clientId]);
      expect(await hasClientAccess(userId, clientId)).toBe(true);
    });

    it('never leaks access across two different clients for the same user', async () => {
      const userId = await makeProfile('client');
      const grantedClientId = await makeClient();
      const otherClientId = await makeClient();
      await query('INSERT INTO user_client_access (user_id, client_id) VALUES ($1, $2)', [userId, grantedClientId]);
      expect(await hasClientAccess(userId, grantedClientId)).toBe(true);
      expect(await hasClientAccess(userId, otherClientId)).toBe(false);
    });
  });
});

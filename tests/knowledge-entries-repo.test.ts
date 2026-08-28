import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import {
  archiveKnowledgeEntry,
  createKnowledgeEntry,
  getKnowledgeEntryById,
  KnowledgeEntryValidationError,
  listKnowledgeEntries,
  restoreKnowledgeEntry,
  updateKnowledgeEntry,
} from '@/lib/server/knowledge-entries-repo';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

// Integration tests against the operator's real local dev PostgreSQL —
// exercises G-Brain Postgres V1's repository layer end to end. Skips
// cleanly when no DATABASE_URL is configured (see tests/helpers/pg-test-env.ts).
const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('lib/server/knowledge-entries-repo (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  // Every entry this file creates is tracked by its OWN id, the instant
  // createEntry() (below) resolves — the only ownership signal that survives
  // whatever a test does to the row afterward (updateKnowledgeEntry clearing
  // client_id on a scope change, archive/restore leaving audit ids null,
  // etc.). This is what afterEach deletes by; a client_id- or
  // created_by/updated_by-keyed DELETE can't still find such a row.
  const createdEntryIds: string[] = [];
  // knowledge_entries.created_by/updated_by are a real UUID FK to
  // profiles(user_id) (profiles.user_id itself FKs to auth.users(id)) — a
  // fake string like 'user-1' fails with "invalid input syntax for type
  // uuid". Two disposable audit users, created once for the whole file and
  // torn down in afterAll, same fixture shape as tests/profiles-repo.test.ts's
  // makeAuthUser/makeProfile (never the real production internal user; two
  // distinct ids so the "createdBy stays untouched while updatedBy changes"
  // test can tell them apart).
  const createdAuthUserIds: string[] = [];

  /** Every test in this file creates entries through this wrapper instead of
   *  calling createKnowledgeEntry directly, so createdEntryIds always has a
   *  complete, accurate record of what to clean up — no call site can forget. */
  async function createEntry(...args: Parameters<typeof createKnowledgeEntry>) {
    const entry = await createKnowledgeEntry(...args);
    createdEntryIds.push(entry.id);
    return entry;
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
      name: 'Knowledge Entries Repo Test Client',
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
    // Primary cleanup: every entry this test created, by its own id.
    if (createdEntryIds.length > 0) {
      await query('DELETE FROM knowledge_entries WHERE id = ANY($1)', [createdEntryIds.splice(0)]);
    }
    // Clients must go after entries above (knowledge_entries.client_id is
    // ON DELETE RESTRICT).
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    // Defensive backstop only — the per-test id-based sweep above is what
    // actually guarantees zero leftover rows; this catches the case of some
    // future test in this file creating an entry through a path other than
    // the tracked createEntry() helper.
    await query('DELETE FROM knowledge_entries WHERE created_by = ANY($1) OR updated_by = ANY($1)', [createdAuthUserIds]);
    for (const id of createdAuthUserIds.splice(0)) {
      await query('DELETE FROM profiles WHERE user_id = $1', [id]);
      await query('DELETE FROM auth.users WHERE id = $1', [id]);
    }
    await closePool();
  });

  describe('createKnowledgeEntry', () => {
    it('creates an internal entry with clientId forced to null and dataSource always manual', async () => {
      const entry = await createEntry({
        scope: 'internal',
        title: 'Internal decision',
        type: 'decision',
        source: 'manual',
        createdBy: userA,
      });

      expect(entry.scope).toBe('internal');
      expect(entry.clientId).toBeNull();
      expect(entry.dataSource).toBe('manual');
      expect(entry.status).toBe('active');
      expect(entry.createdBy).toBe(userA);
      expect(entry.updatedBy).toBe(userA);
      expect(entry.id).toMatch(/^knowledge-/);
    });

    it('creates a client entry for a real client', async () => {
      const client = await makeClient();
      const entry = await createEntry({
        scope: 'client',
        clientId: client.id,
        title: 'Client context',
        type: 'client_context',
        source: 'meeting',
        sourceLabel: 'Kickoff call',
        tags: ['  Test  ', 'test'],
        createdBy: null,
      });

      expect(entry.clientId).toBe(client.id);
      expect(entry.sourceLabel).toBe('Kickoff call');
      expect(entry.tags).toEqual(['Test']); // normalized/deduped
      expect(entry.createdBy).toBeNull();
    });

    it('rejects a client-scoped entry with no clientId (CLIENT_ID_REQUIRED)', async () => {
      await expect(
        createKnowledgeEntry({
          scope: 'client',
          title: 'No client',
          type: 'decision',
          source: 'manual',
          createdBy: null,
        }),
      ).rejects.toMatchObject({ code: 'CLIENT_ID_REQUIRED' } satisfies Partial<KnowledgeEntryValidationError>);
    });

    it('rejects a client-scoped entry for a missing client id (CLIENT_NOT_FOUND)', async () => {
      await expect(
        createKnowledgeEntry({
          scope: 'client',
          clientId: 'client-does-not-exist',
          title: 'Ghost client',
          type: 'decision',
          source: 'manual',
          createdBy: null,
        }),
      ).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
    });
  });

  describe('listKnowledgeEntries', () => {
    it('with no clientId returns internal + every client entry, newest updated_at first', async () => {
      const client = await makeClient();
      const first = await createEntry({ scope: 'internal', title: 'First', type: 'sop', source: 'manual', createdBy: null });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await createEntry({
        scope: 'client',
        clientId: client.id,
        title: 'Second',
        type: 'decision',
        source: 'manual',
        createdBy: null,
      });

      const all = await listKnowledgeEntries();
      const ids = all.map((e) => e.id);
      expect(ids).toContain(first.id);
      expect(ids).toContain(second.id);
      expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id)); // newest first
    });

    it('with a clientId returns only that client entries, never internal, never another client', async () => {
      const clientA = await makeClient();
      const clientB = await makeClient();

      const internalEntry = await createEntry({ scope: 'internal', title: 'Internal', type: 'sop', source: 'manual', createdBy: null });
      const aEntry = await createEntry({ scope: 'client', clientId: clientA.id, title: 'A entry', type: 'decision', source: 'manual', createdBy: null });
      const bEntry = await createEntry({ scope: 'client', clientId: clientB.id, title: 'B entry', type: 'decision', source: 'manual', createdBy: null });

      const aOnly = await listKnowledgeEntries({ clientId: clientA.id });
      const ids = aOnly.map((e) => e.id);
      expect(ids).toContain(aEntry.id);
      expect(ids).not.toContain(bEntry.id);
      expect(ids).not.toContain(internalEntry.id);
    });
  });

  describe('updateKnowledgeEntry', () => {
    it('updates business fields, sets updatedBy, and bumps updatedAt', async () => {
      const entry = await createEntry({ scope: 'internal', title: 'Original', type: 'sop', source: 'manual', createdBy: userA });
      await new Promise((resolve) => setTimeout(resolve, 5));

      const updated = await updateKnowledgeEntry(entry.id, { title: 'Updated title', updatedBy: userB });
      expect(updated?.title).toBe('Updated title');
      expect(updated?.updatedBy).toBe(userB);
      expect(updated?.createdBy).toBe(userA); // untouched
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThan(new Date(entry.updatedAt).getTime());
    });

    it('changing scope from client to internal clears clientId server-side, even without an explicit clientId in the patch', async () => {
      const client = await makeClient();
      const entry = await createEntry({ scope: 'client', clientId: client.id, title: 'Client entry', type: 'client_context', source: 'client', createdBy: null });

      const updated = await updateKnowledgeEntry(entry.id, { scope: 'internal', updatedBy: null });
      expect(updated?.scope).toBe('internal');
      expect(updated?.clientId).toBeNull();
    });

    it('switching scope to client without a valid clientId is rejected (CLIENT_ID_REQUIRED)', async () => {
      const entry = await createEntry({ scope: 'internal', title: 'Internal', type: 'sop', source: 'manual', createdBy: null });
      await expect(updateKnowledgeEntry(entry.id, { scope: 'client', updatedBy: null })).rejects.toMatchObject({ code: 'CLIENT_ID_REQUIRED' });
    });

    it('returns null for an unknown id', async () => {
      expect(await updateKnowledgeEntry('knowledge-does-not-exist', { title: 'x', updatedBy: null })).toBeNull();
    });

    it('never accepts dataSource as anything but manual through this repo (type system enforced — no dataSource field exists on UpdateKnowledgeEntryInput)', async () => {
      const entry = await createEntry({ scope: 'internal', title: 'Manual only', type: 'sop', source: 'manual', createdBy: null });
      expect(entry.dataSource).toBe('manual');
    });
  });

  describe('archive / restore', () => {
    it('archiveKnowledgeEntry sets status to archived without deleting the row', async () => {
      const entry = await createEntry({ scope: 'internal', title: 'To archive', type: 'decision', source: 'manual', createdBy: null });
      const archived = await archiveKnowledgeEntry(entry.id, userA);
      expect(archived?.status).toBe('archived');
      expect(await getKnowledgeEntryById(entry.id)).not.toBeNull();
    });

    it('restoreKnowledgeEntry sets an archived entry back to active', async () => {
      const entry = await createEntry({ scope: 'internal', title: 'To restore', type: 'decision', source: 'manual', createdBy: null });
      await archiveKnowledgeEntry(entry.id, null);
      const restored = await restoreKnowledgeEntry(entry.id, null);
      expect(restored?.status).toBe('active');
    });
  });
});

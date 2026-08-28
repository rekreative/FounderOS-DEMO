import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

/**
 * tests/setup.ts's global "always internal" mock resolves the caller as
 * { id: 'test-internal-user', ... } — fine for every OTHER route test file,
 * which never persists that id anywhere, but this route's POST/PATCH write
 * it straight into knowledge_entries.created_by/updated_by, a real UUID FK
 * to profiles(user_id). A non-UUID string there fails with "invalid input
 * syntax for type uuid" against a real database, so this file overrides the
 * global mock locally (same override mechanism tests/api-auth.test.ts and
 * tests/tenant-access.test.ts already use for @/lib/server/auth) and wires
 * it, in beforeAll below, to a disposable UUID with a matching auth.users +
 * profiles row — never the real production internal user, and never a
 * hardcoded/shared id that could collide with one.
 */
const requireUser = vi.fn();
const requireInternalUser = vi.fn();
const requireClientAccess = vi.fn();
vi.mock('@/lib/server/auth', () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
  requireInternalUser: (...args: unknown[]) => requireInternalUser(...args),
  requireClientAccess: (...args: unknown[]) => requireClientAccess(...args),
}));

const { GET, POST } = await import('@/app/api/knowledge-entries/route');
const { PATCH } = await import('@/app/api/knowledge-entries/[id]/route');

// Every entry this file creates is tracked by its OWN id, the instant POST
// reports it created — the only ownership signal that survives whatever a
// test does afterward (PATCHing client_id to null, leaving audit ids null,
// etc.). This is what afterEach below deletes by; nothing here needs to
// infer ownership from client_id or created_by/updated_by. `res.clone()`
// keeps the original Response body readable by the calling test.
const createdEntryIds: string[] = [];

const getKnowledgeEntries = (qs: string = '') => GET(new Request(`http://x/api/knowledge-entries${qs}`));
const postKnowledgeEntry = async (body: unknown) => {
  const res = await POST(new Request('http://x/api/knowledge-entries', { method: 'POST', body: JSON.stringify(body) }));
  if (res.status === 201) {
    const { entry } = await res.clone().json();
    createdEntryIds.push(entry.id);
  }
  return res;
};
const patchKnowledgeEntry = (id: string, body: unknown) =>
  PATCH(new Request(`http://x/api/knowledge-entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: { id },
  });

describe.runIf(Boolean(TEST_DATABASE_URL))('app/api/knowledge-entries routes (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const testUserId = randomUUID();
  let authFixtureReady = false;

  beforeAll(async () => {
    await query('INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES ($1, false, false)', [testUserId]);
    await query('INSERT INTO profiles (user_id, role) VALUES ($1, $2)', [testUserId, 'internal']);
    authFixtureReady = true;

    const testUser = { id: testUserId, email: 'test-internal-knowledge@rekreative.com', role: 'internal' as const };
    requireUser.mockResolvedValue(testUser);
    requireInternalUser.mockResolvedValue(testUser);
    requireClientAccess.mockResolvedValue(testUser);
  });

  async function makeClient() {
    const client = await createClient({
      name: 'API Knowledge Entries Test Client',
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
    // Primary cleanup: every entry this test created, by its own id — covers
    // internal-scoped rows (no client_id) and any row a test PATCHed to null
    // out its client_id/audit fields, neither of which a client_id- or
    // created_by/updated_by-keyed DELETE could still find afterward.
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
    // the tracked postKnowledgeEntry() helper.
    if (authFixtureReady) {
      await query('DELETE FROM knowledge_entries WHERE created_by = $1 OR updated_by = $1', [testUserId]);
      await query('DELETE FROM profiles WHERE user_id = $1', [testUserId]);
      await query('DELETE FROM auth.users WHERE id = $1', [testUserId]);
    }
    await closePool();
  });

  // requireInternalUserOrResponse() (called by every GET/POST/PATCH below)
  // is backed by the mocked requireInternalUser() wired in beforeAll above,
  // resolving as an internal user with a real, FK-satisfiable UUID id. The
  // real, unmocked 401 boundary (no session at all) is covered by
  // tests/api-internal-protection.test.ts, which deliberately unmocks
  // @/lib/server/auth to exercise the genuine chain.

  it('GET /api/knowledge-entries (no clientId) returns 200 with an entries array', async () => {
    const res = await getKnowledgeEntries();
    expect(res.status).toBe(200);
    const { entries } = await res.json();
    expect(Array.isArray(entries)).toBe(true);
  });

  it('POST creates an internal entry and GET (no clientId) includes it', async () => {
    const postRes = await postKnowledgeEntry({
      scope: 'internal',
      title: 'Test decision',
      type: 'decision',
      source: 'manual',
    });
    expect(postRes.status).toBe(201);
    const { entry } = await postRes.json();
    expect(entry.scope).toBe('internal');
    expect(entry.clientId).toBeNull();
    expect(entry.dataSource).toBe('manual');

    const getRes = await getKnowledgeEntries();
    const { entries } = await getRes.json();
    expect(entries.some((e: { id: string }) => e.id === entry.id)).toBe(true);
  });

  it('POST creates a client entry and GET ?clientId= scopes to it only', async () => {
    const client = await makeClient();
    const postRes = await postKnowledgeEntry({
      scope: 'client',
      clientId: client.id,
      title: 'Client context',
      type: 'client_context',
      source: 'meeting',
      sourceLabel: 'Kickoff',
    });
    expect(postRes.status).toBe(201);
    const { entry } = await postRes.json();
    expect(entry.clientId).toBe(client.id);

    const getRes = await getKnowledgeEntries(`?clientId=${client.id}`);
    expect(getRes.status).toBe(200);
    const { entries } = await getRes.json();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(entry.id);
  });

  it('POST 400s on an invalid body (missing title)', async () => {
    const res = await postKnowledgeEntry({ scope: 'internal', type: 'decision', source: 'manual' });
    expect(res.status).toBe(400);
  });

  it('POST 400s on an unrecognized field (strict schema)', async () => {
    const res = await postKnowledgeEntry({
      scope: 'internal',
      title: 'x',
      type: 'decision',
      source: 'manual',
      dataSource: 'demo',
    });
    expect(res.status).toBe(400);
  });

  it('POST 422s on a client scope with no clientId', async () => {
    const res = await postKnowledgeEntry({ scope: 'client', title: 'x', type: 'decision', source: 'manual' });
    expect(res.status).toBe(422);
  });

  it('POST 422s on a missing client id', async () => {
    const res = await postKnowledgeEntry({
      scope: 'client',
      clientId: 'client-does-not-exist',
      title: 'x',
      type: 'decision',
      source: 'manual',
    });
    expect(res.status).toBe(422);
  });

  it('POST creates an entry with createdBy/updatedBy set from the authenticated user, never the request body', async () => {
    const res = await postKnowledgeEntry({ scope: 'internal', title: 'Audited', type: 'sop', source: 'manual' });
    expect(res.status).toBe(201);
    const { entry } = await res.json();
    expect(entry.createdBy).toBe(testUserId);
    expect(entry.updatedBy).toBe(testUserId);
  });

  it('PATCH updates an existing entry', async () => {
    const created = await (await postKnowledgeEntry({ scope: 'internal', title: 'Original', type: 'sop', source: 'manual' })).json();
    const res = await patchKnowledgeEntry(created.entry.id, { title: 'Updated' });
    expect(res.status).toBe(200);
    const { entry } = await res.json();
    expect(entry.title).toBe('Updated');
  });

  it('PATCH { status: "archived" } archives and { status: "active" } restores', async () => {
    const created = await (await postKnowledgeEntry({ scope: 'internal', title: 'To archive', type: 'decision', source: 'manual' })).json();

    const archivedRes = await patchKnowledgeEntry(created.entry.id, { status: 'archived' });
    expect(archivedRes.status).toBe(200);
    expect((await archivedRes.json()).entry.status).toBe('archived');

    const restoredRes = await patchKnowledgeEntry(created.entry.id, { status: 'active' });
    expect(restoredRes.status).toBe(200);
    expect((await restoredRes.json()).entry.status).toBe('active');
  });

  it('PATCH 404s on an unknown id', async () => {
    const res = await patchKnowledgeEntry('knowledge-does-not-exist', { title: 'x' });
    expect(res.status).toBe(404);
  });

  it('PATCH ignores caller-supplied audit/source fields (strict schema rejects them)', async () => {
    const created = await (await postKnowledgeEntry({ scope: 'internal', title: 'Original', type: 'sop', source: 'manual' })).json();
    const res = await patchKnowledgeEntry(created.entry.id, { title: 'x', createdBy: 'attacker-controlled-id' });
    expect(res.status).toBe(400);
  });

  it('PATCH switching scope to internal clears clientId', async () => {
    const client = await makeClient();
    const created = await (
      await postKnowledgeEntry({ scope: 'client', clientId: client.id, title: 'Client entry', type: 'client_context', source: 'client' })
    ).json();

    const res = await patchKnowledgeEntry(created.entry.id, { scope: 'internal' });
    expect(res.status).toBe(200);
    const { entry } = await res.json();
    expect(entry.scope).toBe('internal');
    expect(entry.clientId).toBeNull();
  });
});

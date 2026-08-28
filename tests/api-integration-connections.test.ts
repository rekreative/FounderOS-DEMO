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
 * it straight into integration_connections.created_by/updated_by, a real
 * UUID FK to profiles(user_id). A non-UUID string there fails with "invalid
 * input syntax for type uuid" against a real database, so this file
 * overrides the global mock locally (same override mechanism
 * tests/api-knowledge-entries.test.ts already uses) and wires it, in
 * beforeAll below, to a disposable UUID with a matching auth.users + profiles
 * row — never the real production internal user, and never a
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

const { GET, POST } = await import('@/app/api/integration-connections/route');
const { PATCH } = await import('@/app/api/integration-connections/[id]/route');

// Every connection this file creates is tracked by its OWN id, the instant
// POST reports it created — the only ownership signal that survives whatever
// a test does afterward (PATCHing client_id to null, archiving, etc.).
// `res.clone()` keeps the original Response body readable by the calling test.
const createdConnectionIds: string[] = [];

const getConnections = (qs: string = '') => GET(new Request(`http://x/api/integration-connections${qs}`));
const postConnection = async (body: unknown) => {
  const res = await POST(new Request('http://x/api/integration-connections', { method: 'POST', body: JSON.stringify(body) }));
  if (res.status === 201) {
    const { connection } = await res.clone().json();
    createdConnectionIds.push(connection.id);
  }
  return res;
};
const patchConnection = (id: string, body: unknown) =>
  PATCH(new Request(`http://x/api/integration-connections/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: { id },
  });

describe.runIf(Boolean(TEST_DATABASE_URL))('app/api/integration-connections routes (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const testUserId = randomUUID();
  let authFixtureReady = false;

  beforeAll(async () => {
    await query('INSERT INTO auth.users (id, is_sso_user, is_anonymous) VALUES ($1, false, false)', [testUserId]);
    await query('INSERT INTO profiles (user_id, role) VALUES ($1, $2)', [testUserId, 'internal']);
    authFixtureReady = true;

    const testUser = { id: testUserId, email: 'test-internal-connections@rekreative.com', role: 'internal' as const };
    requireUser.mockResolvedValue(testUser);
    requireInternalUser.mockResolvedValue(testUser);
    requireClientAccess.mockResolvedValue(testUser);
  });

  async function makeClient() {
    const client = await createClient({
      name: 'API Integration Connections Test Client',
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
    if (authFixtureReady) {
      await query('DELETE FROM integration_connections WHERE created_by = $1 OR updated_by = $1', [testUserId]);
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
  // @/lib/server/auth to exercise the genuine chain; tests/api-auth-inventory.test.ts
  // structurally proves every method on this route is wired to
  // requireInternalUserOrResponse().

  it('GET /api/integration-connections returns 200 with an active-only connections array', async () => {
    const res = await getConnections();
    expect(res.status).toBe(200);
    const { connections } = await res.json();
    expect(Array.isArray(connections)).toBe(true);
    expect(connections.every((c: { status: string }) => c.status === 'active')).toBe(true);
  });

  it('POST creates an internal connection and GET includes it', async () => {
    const postRes = await postConnection({ scope: 'internal', platform: 'make', name: 'Test Make connection' });
    expect(postRes.status).toBe(201);
    const { connection } = await postRes.json();
    expect(connection.scope).toBe('internal');
    expect(connection.clientId).toBeNull();
    expect(connection.dataSource).toBe('manual');
    expect(connection.status).toBe('active');
    expect(connection.verificationStatus).toBe('not_verified');

    const getRes = await getConnections();
    const { connections } = await getRes.json();
    expect(connections.some((c: { id: string }) => c.id === connection.id)).toBe(true);
  });

  it('POST creates a client connection and GET ?clientId= scopes to it only', async () => {
    const client = await makeClient();
    const postRes = await postConnection({
      scope: 'client',
      clientId: client.id,
      platform: 'meta',
      name: 'Client connection',
      externalRef: 'act_123',
    });
    expect(postRes.status).toBe(201);
    const { connection } = await postRes.json();
    expect(connection.clientId).toBe(client.id);

    const getRes = await getConnections(`?clientId=${client.id}`);
    expect(getRes.status).toBe(200);
    const { connections } = await getRes.json();
    expect(connections).toHaveLength(1);
    expect(connections[0].id).toBe(connection.id);
  });

  it('POST 400s on an invalid body (missing name)', async () => {
    const res = await postConnection({ scope: 'internal', platform: 'make' });
    expect(res.status).toBe(400);
  });

  it('POST 400s on an unrecognized field (strict schema) — dataSource cannot be caller-controlled', async () => {
    const res = await postConnection({ scope: 'internal', platform: 'make', name: 'x', dataSource: 'demo' });
    expect(res.status).toBe(400);
  });

  it('POST 400s on a name longer than the schema max', async () => {
    const res = await postConnection({ scope: 'internal', platform: 'make', name: 'x'.repeat(500) });
    expect(res.status).toBe(400);
  });

  it('POST 422s on a client scope with no clientId', async () => {
    const res = await postConnection({ scope: 'client', platform: 'meta', name: 'x' });
    expect(res.status).toBe(422);
  });

  it('POST 422s on a missing client id — validated against the real clients table', async () => {
    const res = await postConnection({ scope: 'client', clientId: 'client-does-not-exist', platform: 'meta', name: 'x' });
    expect(res.status).toBe(422);
  });

  it('POST creates a connection with createdBy/updatedBy set from the authenticated user, never the request body', async () => {
    const res = await postConnection({ scope: 'internal', platform: 'make', name: 'Audited' });
    expect(res.status).toBe(201);
    const { connection } = await res.json();
    expect(connection.createdBy).toBe(testUserId);
    expect(connection.updatedBy).toBe(testUserId);
  });

  it('POST ignores a caller-supplied id/createdBy (strict schema rejects them)', async () => {
    const res = await postConnection({ scope: 'internal', platform: 'make', name: 'x', id: 'connection-attacker', createdBy: 'attacker-controlled-id' });
    expect(res.status).toBe(400);
  });

  describe('PATCH action: edit', () => {
    it('updates business fields', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'Original' })).json();
      const res = await patchConnection(created.connection.id, { action: 'edit', name: 'Updated' });
      expect(res.status).toBe(200);
      const { connection } = await res.json();
      expect(connection.name).toBe('Updated');
    });

    it('switching scope to internal clears clientId', async () => {
      const client = await makeClient();
      const created = await (
        await postConnection({ scope: 'client', clientId: client.id, platform: 'whatsapp', name: 'Client connection' })
      ).json();

      const res = await patchConnection(created.connection.id, { action: 'edit', scope: 'internal' });
      expect(res.status).toBe(200);
      const { connection } = await res.json();
      expect(connection.scope).toBe('internal');
      expect(connection.clientId).toBeNull();
    });

    it('404s on an unknown id', async () => {
      const res = await patchConnection('connection-does-not-exist', { action: 'edit', name: 'x' });
      expect(res.status).toBe(404);
    });

    it('rejects an empty edit body (no business field beyond action)', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'Original' })).json();
      const res = await patchConnection(created.connection.id, { action: 'edit' });
      expect(res.status).toBe(400);
    });

    it('ignores caller-supplied audit/verification/status fields (strict schema rejects them)', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'Original' })).json();
      const res = await patchConnection(created.connection.id, {
        action: 'edit',
        name: 'x',
        createdBy: 'attacker-controlled-id',
        verificationStatus: 'verified',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH action: verify', () => {
    it('verified sets verificationStatus verified, method manual (server-derived), and a timestamp', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'To verify' })).json();
      const res = await patchConnection(created.connection.id, { action: 'verify', status: 'verified' });
      expect(res.status).toBe(200);
      const { connection } = await res.json();
      expect(connection.verificationStatus).toBe('verified');
      expect(connection.verificationMethod).toBe('manual');
      expect(connection.lastVerifiedAt).not.toBeNull();
    });

    it('failed sets verificationStatus failed', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'To fail' })).json();
      const res = await patchConnection(created.connection.id, { action: 'verify', status: 'failed' });
      expect(res.status).toBe(200);
      expect((await res.json()).connection.verificationStatus).toBe('failed');
    });

    it('not_verified resets method and timestamp to null', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'To reset' })).json();
      await patchConnection(created.connection.id, { action: 'verify', status: 'verified' });
      const res = await patchConnection(created.connection.id, { action: 'verify', status: 'not_verified' });
      expect(res.status).toBe(200);
      const { connection } = await res.json();
      expect(connection.verificationStatus).toBe('not_verified');
      expect(connection.verificationMethod).toBeNull();
      expect(connection.lastVerifiedAt).toBeNull();
    });

    it('rejects a caller-supplied verificationMethod — the server always derives it', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'x' })).json();
      const res = await patchConnection(created.connection.id, { action: 'verify', status: 'verified', verificationMethod: 'system' });
      expect(res.status).toBe(400);
    });

    it('rejects an invalid verification target', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'x' })).json();
      const res = await patchConnection(created.connection.id, { action: 'verify', status: 'archived' });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH action: archive', () => {
    it('archived archives; active restores; the record survives (no delete)', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'To archive' })).json();

      const archivedRes = await patchConnection(created.connection.id, { action: 'archive', status: 'archived' });
      expect(archivedRes.status).toBe(200);
      expect((await archivedRes.json()).connection.status).toBe('archived');

      const activeListAfterArchive = await (await getConnections()).json();
      expect(activeListAfterArchive.connections.some((c: { id: string }) => c.id === created.connection.id)).toBe(false);

      const archivedList = await (await getConnections('?status=archived')).json();
      expect(archivedList.connections.some((c: { id: string }) => c.id === created.connection.id)).toBe(true);

      const restoredRes = await patchConnection(created.connection.id, { action: 'archive', status: 'active' });
      expect(restoredRes.status).toBe(200);
      expect((await restoredRes.json()).connection.status).toBe('active');
    });
  });

  describe('malformed and ambiguous PATCH requests', () => {
    it('rejects a request with no action', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'x' })).json();
      const res = await patchConnection(created.connection.id, { name: 'no action field' });
      expect(res.status).toBe(400);
    });

    it('rejects a request mixing an edit field into a verify/archive action', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'x' })).json();
      const res = await patchConnection(created.connection.id, { action: 'verify', status: 'verified', name: 'sneaking in an edit' });
      expect(res.status).toBe(400);
    });

    it('rejects an unrecognized action', async () => {
      const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'x' })).json();
      const res = await patchConnection(created.connection.id, { action: 'delete' });
      expect(res.status).toBe(400);
    });
  });

  it('no response ever includes a raw secret-looking field — the API surface has no credential column at all', async () => {
    const created = await (await postConnection({ scope: 'internal', platform: 'make', name: 'x', externalRef: 'act_123' })).json();
    const keys = Object.keys(created.connection);
    expect(keys).not.toContain('secret');
    expect(keys).not.toContain('apiKey');
    expect(keys).not.toContain('token');
    expect(keys).not.toContain('password');
  });
});

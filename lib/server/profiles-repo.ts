import { query, withTransaction } from './db';
import { getClientById, type ServerClient } from './clients-repo';

/**
 * Server-only PostgreSQL repository for the profiles / user_client_access
 * tables (Auth V1's application-authorization metadata — see
 * lib/server/migrations/0005_auth_foundation.sql). Read-only: nothing here
 * writes a profile or an access grant — that belongs to the future
 * bootstrap/invite milestones. Consumed exclusively by lib/server/auth.ts;
 * never call these directly from a route — go through requireUser() /
 * requireInternalUser() / requireClientAccess() instead.
 */

type ProfileRow = { role: string };

/**
 * Returns the raw stored role, or null when no profile row exists at all.
 * Deliberately does NOT validate the value against ('internal'|'client')
 * here — that distinction (no row vs. an unrecognized role value) is
 * lib/server/auth.ts's to make (NO_PROFILE vs INVALID_ROLE are different
 * AuthError codes); collapsing both to null here would make them
 * indistinguishable to the caller.
 *
 * profiles_pkey is PRIMARY KEY (user_id) — direct index hit, no scan.
 */
export async function getProfileRole(userId: string): Promise<string | null> {
  const result = await query<ProfileRow>('SELECT role FROM profiles WHERE user_id = $1', [userId]);
  return result.rowCount === 0 ? null : result.rows[0].role;
}

/**
 * user_client_access_pkey is PRIMARY KEY (user_id, client_id) — user_id is
 * the leading column, so this is served by the same PK btree; no join to
 * clients is needed (client_id REFERENCES clients(id) ON DELETE CASCADE
 * already guarantees a matching row can only exist for a client that's
 * still there).
 */
export async function hasClientAccess(userId: string, clientId: string): Promise<boolean> {
  const result = await query('SELECT 1 FROM user_client_access WHERE user_id = $1 AND client_id = $2', [
    userId,
    clientId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Returns only the canonical client records granted to one client-role user.
 * The canonical lookups keep the portal fail-closed when a stale grant somehow exists:
 * a client that no longer exists is never rendered as an accessible tenant.
 */
export async function listAccessibleClients(userId: string): Promise<ServerClient[]> {
  const grants = await query<{ client_id: string }>(
    'SELECT client_id FROM user_client_access WHERE user_id = $1 ORDER BY created_at ASC',
    [userId],
  );

  const clients = await Promise.all(grants.rows.map((grant) => getClientById(grant.client_id)));
  return clients.filter((client): client is ServerClient => client !== null);
}

export class ClientAccessProvisionError extends Error {}

/**
 * Grants a Supabase identity access to exactly one client tenant. This is an
 * application-side transaction: a pre-existing internal account is never
 * down-graded to a client account, and a missing client is never granted.
 */
export async function provisionClientAccess(userId: string, clientId: string): Promise<void> {
  await withTransaction(async (client) => {
    const target = await client.query('SELECT 1 FROM clients WHERE id = $1', [clientId]);
    if (target.rowCount === 0) throw new ClientAccessProvisionError('client not found');

    const profile = await client.query<{ role: string }>('SELECT role FROM profiles WHERE user_id = $1 FOR UPDATE', [userId]);
    if (profile.rowCount && profile.rows[0].role !== 'client') {
      throw new ClientAccessProvisionError('an internal account cannot be converted into a client account');
    }

    if (profile.rowCount === 0) {
      await client.query("INSERT INTO profiles (user_id, role) VALUES ($1, 'client')", [userId]);
    }
    await client.query(
      'INSERT INTO user_client_access (user_id, client_id) VALUES ($1, $2) ON CONFLICT (user_id, client_id) DO NOTHING',
      [userId, clientId],
    );
  });
}

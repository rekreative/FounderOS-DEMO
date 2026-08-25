import { query } from './db';

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

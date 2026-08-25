import { getSupabaseUser } from '@/lib/supabase/user';
import { AuthError } from './auth-errors';
import { getProfileRole, hasClientAccess } from './profiles-repo';

/**
 * Central server-only authorization layer. Identity comes from Supabase
 * (lib/supabase/user.ts's getSupabaseUser(), which uses auth.getUser() —
 * never auth.getSession() — so every result here is revalidated against
 * Supabase's Auth server, not just decoded from a cookie); role and client
 * assignment come from profiles / user_client_access via
 * lib/server/profiles-repo.ts, read through the same pg.Pool connection
 * every other repo in this codebase already uses.
 *
 * Every helper throws AuthError rather than returning a Response — that
 * keeps them usable from a Route Handler (catch it, map to jsonError) and,
 * later, a Server Component/layout (catch it, map to redirect()) without
 * coupling the helpers themselves to either.
 */

export type AuthUser = {
  id: string;
  email: string | null;
  role: 'internal' | 'client';
};

/**
 * Verifies the caller has a valid Supabase session AND a provisioned
 * profiles row with a recognized role. Fails closed at every step: no
 * session, an auth error, a missing profile, or an unrecognized role value
 * all reject rather than falling through to a default.
 */
export async function requireUser(): Promise<AuthUser> {
  // Not destructured before the check: getUser()'s return type is a
  // discriminated union keyed on `error` (data.user is only typed non-null
  // on the branch where error is null) — checking result.error directly
  // keeps that narrowing intact for the result.data.user access below.
  const result = await getSupabaseUser();
  if (result.error || !result.data.user) {
    throw new AuthError(401, 'UNAUTHENTICATED');
  }
  const authUser = result.data.user;

  const role = await getProfileRole(authUser.id);
  if (role === null) {
    throw new AuthError(403, 'NO_PROFILE');
  }
  if (role !== 'internal' && role !== 'client') {
    // The DB CHECK constraint on profiles.role already prevents this at
    // write time — this only guards against future schema/code drift, and
    // never grants a default privilege level for an unrecognized value.
    throw new AuthError(403, 'INVALID_ROLE');
  }

  return { id: authUser.id, email: authUser.email ?? null, role };
}

/** requireUser() plus: the caller's role must be 'internal'. No owner/operator split in V1. */
export async function requireInternalUser(): Promise<AuthUser> {
  const user = await requireUser();
  if (user.role !== 'internal') {
    throw new AuthError(403, 'NOT_INTERNAL');
  }
  return user;
}

/**
 * requireUser() plus client scoping:
 * - internal: always allowed, with or without a clientId, and never queries
 *   user_client_access — internal access is by role, not by grant.
 * - client: clientId is required (missing/empty/whitespace is rejected
 *   before any query runs) and must have a matching user_client_access row.
 *   No separate check that the client itself exists — client_id REFERENCES
 *   clients(id) ON DELETE CASCADE already makes a matching access row
 *   impossible unless the client is still there.
 */
export async function requireClientAccess(clientId: string | undefined): Promise<AuthUser> {
  const user = await requireUser();

  if (user.role === 'internal') {
    return user;
  }

  if (!clientId || clientId.trim() === '') {
    throw new AuthError(403, 'CLIENT_ID_REQUIRED');
  }

  const granted = await hasClientAccess(user.id, clientId);
  if (!granted) {
    throw new AuthError(403, 'CLIENT_ACCESS_DENIED');
  }

  return user;
}

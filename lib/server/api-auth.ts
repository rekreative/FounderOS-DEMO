import { jsonError } from './http';
import { requireInternalUser, requireUser, requireClientAccess, type AuthUser } from './auth';
import { AuthError } from './auth-errors';
import { hasClientAccess } from './profiles-repo';

/**
 * Small, repo-consistent guard for internal-only API routes — reuses
 * requireInternalUser()/AuthError/jsonError() exactly as already built and
 * tested, rather than a new abstraction. An explicit early-return guard
 * (matching how every route already validates its own body with
 * `schema.safeParse(...)` + early return) rather than a wrapping
 * higher-order handler, which would change every route's export shape more
 * invasively than this codebase's existing conventions call for.
 *
 * Usage:
 *   const auth = await requireInternalUserOrResponse();
 *   if ('response' in auth) return auth.response;
 *   // ...existing handler logic, auth.user available if needed
 */
export type RequireInternalUserResult = { user: AuthUser } | { response: Response };

export async function requireInternalUserOrResponse(): Promise<RequireInternalUserResult> {
  try {
    return { user: await requireInternalUser() };
  } catch (error) {
    if (error instanceof AuthError) {
      return { response: jsonError(error.status, error.message, { code: error.code }) };
    }
    throw error;
  }
}

export type RequireClientAccessResult = { user: AuthUser } | { response: Response };

/**
 * Tenant-aware guard for list/aggregate READ routes (GET /api/leads?clientId=…,
 * /api/results, /api/meta-ads/campaigns, /api/meta-ads/accounts): internal
 * gets global access with or without a clientId; a client-role caller must
 * supply a clientId it holds a user_client_access grant for — omitting it
 * is rejected rather than silently falling through to global data. There's
 * no single object here whose existence a 404 would need to hide, so a
 * denial surfaces requireClientAccess()'s real status (403), same as every
 * other AuthError mapping in this file.
 */
export async function requireClientAccessOrResponse(clientId: string | undefined): Promise<RequireClientAccessResult> {
  try {
    return { user: await requireClientAccess(clientId) };
  } catch (error) {
    if (error instanceof AuthError) {
      return { response: jsonError(error.status, error.message, { code: error.code }) };
    }
    throw error;
  }
}

/**
 * Base session+role guard for object-scoped READ routes (GET /api/clients/[id],
 * /api/leads/[id], /api/leads/[id]/events, /api/ops/status/client/[clientId]):
 * these can't decide tenant access until AFTER the object is fetched (its
 * own client_id column is the authorization scope — see
 * canAccessClientScopedObject below), so this only resolves identity
 * (401/403 for no session, no profile, or an invalid role) and leaves the
 * per-object decision to the route.
 */
export async function requireUserOrResponse(): Promise<RequireClientAccessResult> {
  try {
    return { user: await requireUser() };
  } catch (error) {
    if (error instanceof AuthError) {
      return { response: jsonError(error.status, error.message, { code: error.code }) };
    }
    throw error;
  }
}

/**
 * Pairs with requireUserOrResponse() for object-scoped READ routes. Takes
 * the object's OWN stored client_id (objectClientId) — never a caller-
 * supplied query/body clientId, which would let a client user point at a
 * tenant they don't hold to read someone else's object. Internal: always
 * true. Client: requires an exact user_client_access grant for that
 * clientId; an object whose clientId is null (internal-scoped) is invisible
 * to every client-role caller — there's no clientId to ever grant against.
 * Callers must map `false` to the SAME 404 they use for a genuinely missing
 * object, never a 403 — a denial must not confirm the object exists.
 */
export async function canAccessClientScopedObject(user: AuthUser, objectClientId: string | null): Promise<boolean> {
  if (user.role === 'internal') return true;
  if (!objectClientId) return false;
  return hasClientAccess(user.id, objectClientId);
}

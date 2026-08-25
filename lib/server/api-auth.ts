import { jsonError } from './http';
import { requireInternalUser, type AuthUser } from './auth';
import { AuthError } from './auth-errors';

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

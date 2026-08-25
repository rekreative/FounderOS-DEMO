/**
 * Typed authorization error for lib/server/auth.ts's requireUser() /
 * requireInternalUser() / requireClientAccess(). Mirrors the existing
 * LeadValidationError pattern (lib/server/leads-repo.ts): a plain Error
 * subclass carrying a machine-readable code, thrown by the helper and
 * caught with `instanceof` by whatever calls it — a Route Handler mapping
 * it to jsonError(error.status, ...), or later a Server Component/layout
 * mapping it to redirect(). Never carries a raw DB error or any secret —
 * every message here is a fixed, static string.
 */

export type AuthErrorCode =
  | 'UNAUTHENTICATED'
  | 'NO_PROFILE'
  | 'INVALID_ROLE'
  | 'NOT_INTERNAL'
  | 'CLIENT_ID_REQUIRED'
  | 'CLIENT_ACCESS_DENIED';

const MESSAGES: Record<AuthErrorCode, string> = {
  UNAUTHENTICATED: 'authentication required',
  NO_PROFILE: 'no profile is provisioned for this account',
  INVALID_ROLE: 'this account has an unrecognized role',
  NOT_INTERNAL: 'this action requires an internal account',
  CLIENT_ID_REQUIRED: 'a clientId is required',
  CLIENT_ACCESS_DENIED: 'you do not have access to this client',
};

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    public readonly code: AuthErrorCode,
  ) {
    super(MESSAGES[code]);
    this.name = 'AuthError';
  }
}

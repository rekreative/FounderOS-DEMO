import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSupabaseUser = vi.fn();
const getProfileRole = vi.fn();
const hasClientAccess = vi.fn();

vi.mock('@/lib/supabase/user', () => ({ getSupabaseUser: (...args: unknown[]) => getSupabaseUser(...args) }));
vi.mock('@/lib/server/profiles-repo', () => ({
  getProfileRole: (...args: unknown[]) => getProfileRole(...args),
  hasClientAccess: (...args: unknown[]) => hasClientAccess(...args),
}));
// This file tests lib/server/auth.ts itself — defeat the global "always
// internal" test default (tests/setup.ts) so the REAL module runs here,
// against the mocked lower-level dependencies above.
vi.unmock('@/lib/server/auth');

const { AuthError } = await import('@/lib/server/auth-errors');
const { requireUser, requireInternalUser, requireClientAccess } = await import('@/lib/server/auth');

const AUTH_USER = { id: 'user-1', email: 'operator@rekreative.com' };

function mockSession(user: typeof AUTH_USER | null, error: { message: string } | null = null) {
  getSupabaseUser.mockResolvedValue({ data: { user }, error });
}

async function expectAuthError(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toMatchObject({ status, code });
  await expect(promise).rejects.toBeInstanceOf(AuthError);
}

beforeEach(() => {
  getSupabaseUser.mockReset();
  getProfileRole.mockReset();
  hasClientAccess.mockReset();
});

describe('requireUser', () => {
  it('no session → 401 UNAUTHENTICATED', async () => {
    mockSession(null);
    await expectAuthError(requireUser(), 401, 'UNAUTHENTICATED');
  });

  it('auth error → 401 UNAUTHENTICATED', async () => {
    mockSession(null, { message: 'jwt expired' });
    await expectAuthError(requireUser(), 401, 'UNAUTHENTICATED');
  });

  it('auth error even with a user present → 401 UNAUTHENTICATED (error takes priority)', async () => {
    mockSession(AUTH_USER, { message: 'jwt expired' });
    await expectAuthError(requireUser(), 401, 'UNAUTHENTICATED');
  });

  it('valid user, no profile row → 403 NO_PROFILE', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue(null);
    await expectAuthError(requireUser(), 403, 'NO_PROFILE');
  });

  it('valid user, unrecognized role value → 403 INVALID_ROLE', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('owner');
    await expectAuthError(requireUser(), 403, 'INVALID_ROLE');
  });

  it('internal profile → success', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('internal');
    await expect(requireUser()).resolves.toEqual({ id: 'user-1', email: 'operator@rekreative.com', role: 'internal' });
  });

  it('client profile → success', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('client');
    await expect(requireUser()).resolves.toEqual({ id: 'user-1', email: 'operator@rekreative.com', role: 'client' });
  });

  it('never exposes the raw Supabase user object — only id/email/role', async () => {
    mockSession({ ...AUTH_USER, app_metadata: { secret: 'x' } } as typeof AUTH_USER);
    getProfileRole.mockResolvedValue('internal');
    const result = await requireUser();
    expect(Object.keys(result).sort()).toEqual(['email', 'id', 'role']);
  });
});

describe('requireInternalUser', () => {
  it('internal → success', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('internal');
    await expect(requireInternalUser()).resolves.toMatchObject({ role: 'internal' });
  });

  it('client → 403 NOT_INTERNAL', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('client');
    await expectAuthError(requireInternalUser(), 403, 'NOT_INTERNAL');
  });

  it('unauthenticated propagates 401 UNAUTHENTICATED', async () => {
    mockSession(null);
    await expectAuthError(requireInternalUser(), 401, 'UNAUTHENTICATED');
  });

  it('no-profile propagates 403 NO_PROFILE', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue(null);
    await expectAuthError(requireInternalUser(), 403, 'NO_PROFILE');
  });
});

describe('requireClientAccess', () => {
  it('internal + omitted clientId → success, hasClientAccess never called', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('internal');
    await expect(requireClientAccess(undefined)).resolves.toMatchObject({ role: 'internal' });
    expect(hasClientAccess).not.toHaveBeenCalled();
  });

  it('internal + a clientId → success, hasClientAccess never called', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('internal');
    await expect(requireClientAccess('client-acme')).resolves.toMatchObject({ role: 'internal' });
    expect(hasClientAccess).not.toHaveBeenCalled();
  });

  it('client + own clientId → success', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('client');
    hasClientAccess.mockResolvedValue(true);
    await expect(requireClientAccess('client-acme')).resolves.toMatchObject({ role: 'client' });
    expect(hasClientAccess).toHaveBeenCalledWith('user-1', 'client-acme');
  });

  it('client + another clientId (no matching row) → 403 CLIENT_ACCESS_DENIED', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('client');
    hasClientAccess.mockResolvedValue(false);
    await expectAuthError(requireClientAccess('client-other'), 403, 'CLIENT_ACCESS_DENIED');
  });

  it('client + omitted clientId → 403 CLIENT_ID_REQUIRED, hasClientAccess never called', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('client');
    await expectAuthError(requireClientAccess(undefined), 403, 'CLIENT_ID_REQUIRED');
    expect(hasClientAccess).not.toHaveBeenCalled();
  });

  it('client + empty string clientId → 403 CLIENT_ID_REQUIRED', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('client');
    await expectAuthError(requireClientAccess(''), 403, 'CLIENT_ID_REQUIRED');
    expect(hasClientAccess).not.toHaveBeenCalled();
  });

  it('client + whitespace-only clientId → 403 CLIENT_ID_REQUIRED', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('client');
    await expectAuthError(requireClientAccess('   '), 403, 'CLIENT_ID_REQUIRED');
    expect(hasClientAccess).not.toHaveBeenCalled();
  });

  it('client + a non-empty unknown clientId → 403 CLIENT_ACCESS_DENIED, no special-cased validation', async () => {
    mockSession(AUTH_USER);
    getProfileRole.mockResolvedValue('client');
    hasClientAccess.mockResolvedValue(false);
    await expectAuthError(requireClientAccess('not-a-real-client-id'), 403, 'CLIENT_ACCESS_DENIED');
    expect(hasClientAccess).toHaveBeenCalledWith('user-1', 'not-a-real-client-id');
  });

  it('unauthenticated → 401 UNAUTHENTICATED', async () => {
    mockSession(null);
    await expectAuthError(requireClientAccess('client-acme'), 401, 'UNAUTHENTICATED');
    expect(hasClientAccess).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireInternalUser = vi.fn();
const requireUser = vi.fn();
const requireClientAccess = vi.fn();
const hasClientAccess = vi.fn();

vi.mock('@/lib/server/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUser(...args),
  requireUser: (...args: unknown[]) => requireUser(...args),
  requireClientAccess: (...args: unknown[]) => requireClientAccess(...args),
}));
vi.mock('@/lib/server/profiles-repo', () => ({
  hasClientAccess: (...args: unknown[]) => hasClientAccess(...args),
}));

const { requireInternalUserOrResponse, requireClientAccessOrResponse, requireUserOrResponse, canAccessClientScopedObject } = await import(
  '@/lib/server/api-auth'
);
const { AuthError } = await import('@/lib/server/auth-errors');

describe('requireInternalUserOrResponse', () => {
  it('unauthenticated → a 401 Response, code UNAUTHENTICATED', async () => {
    requireInternalUser.mockRejectedValue(new AuthError(401, 'UNAUTHENTICATED'));

    const result = await requireInternalUserOrResponse();

    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.code).toBe('UNAUTHENTICATED');
    }
  });

  it('authenticated but non-internal (client role) → a 403 Response, code NOT_INTERNAL', async () => {
    requireInternalUser.mockRejectedValue(new AuthError(403, 'NOT_INTERNAL'));

    const result = await requireInternalUserOrResponse();

    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(403);
      const body = await result.response.json();
      expect(body.code).toBe('NOT_INTERNAL');
    }
  });

  it('internal → returns the user, no response short-circuit', async () => {
    const user = { id: 'user-1', email: 'operator@rekreative.com', role: 'internal' as const };
    requireInternalUser.mockResolvedValue(user);

    const result = await requireInternalUserOrResponse();

    expect('response' in result).toBe(false);
    if (!('response' in result)) expect(result.user).toEqual(user);
  });

  it('a non-AuthError propagates rather than being flattened into a response', async () => {
    requireInternalUser.mockRejectedValue(new Error('unexpected DB failure'));

    await expect(requireInternalUserOrResponse()).rejects.toThrow('unexpected DB failure');
  });
});

describe('requireClientAccessOrResponse', () => {
  it('delegates to requireClientAccess() with the given clientId and returns the user on success', async () => {
    const user = { id: 'client-user-1', email: 'client@rekreative.com', role: 'client' as const };
    requireClientAccess.mockResolvedValue(user);

    const result = await requireClientAccessOrResponse('client-acme');

    expect(requireClientAccess).toHaveBeenCalledWith('client-acme');
    expect('response' in result).toBe(false);
    if (!('response' in result)) expect(result.user).toEqual(user);
  });

  it('missing clientId for a client-role caller → a 403 Response, code CLIENT_ID_REQUIRED', async () => {
    requireClientAccess.mockRejectedValue(new AuthError(403, 'CLIENT_ID_REQUIRED'));

    const result = await requireClientAccessOrResponse(undefined);

    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(403);
      const body = await result.response.json();
      expect(body.code).toBe('CLIENT_ID_REQUIRED');
    }
  });

  it('no grant for the requested clientId → a 403 Response, code CLIENT_ACCESS_DENIED', async () => {
    requireClientAccess.mockRejectedValue(new AuthError(403, 'CLIENT_ACCESS_DENIED'));

    const result = await requireClientAccessOrResponse('client-other');

    expect('response' in result).toBe(true);
    if ('response' in result) expect(result.response.status).toBe(403);
  });

  it('unauthenticated → a 401 Response, code UNAUTHENTICATED', async () => {
    requireClientAccess.mockRejectedValue(new AuthError(401, 'UNAUTHENTICATED'));

    const result = await requireClientAccessOrResponse('client-acme');

    expect('response' in result).toBe(true);
    if ('response' in result) expect(result.response.status).toBe(401);
  });

  it('a non-AuthError propagates rather than being flattened into a response', async () => {
    requireClientAccess.mockRejectedValue(new Error('unexpected DB failure'));

    await expect(requireClientAccessOrResponse('client-acme')).rejects.toThrow('unexpected DB failure');
  });
});

describe('requireUserOrResponse', () => {
  it('any authenticated role (not just internal) → returns the user, no response short-circuit', async () => {
    const user = { id: 'client-user-1', email: 'client@rekreative.com', role: 'client' as const };
    requireUser.mockResolvedValue(user);

    const result = await requireUserOrResponse();

    expect('response' in result).toBe(false);
    if (!('response' in result)) expect(result.user).toEqual(user);
  });

  it('unauthenticated → a 401 Response, code UNAUTHENTICATED', async () => {
    requireUser.mockRejectedValue(new AuthError(401, 'UNAUTHENTICATED'));

    const result = await requireUserOrResponse();

    expect('response' in result).toBe(true);
    if ('response' in result) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.code).toBe('UNAUTHENTICATED');
    }
  });

  it('no profile → a 403 Response, code NO_PROFILE', async () => {
    requireUser.mockRejectedValue(new AuthError(403, 'NO_PROFILE'));

    const result = await requireUserOrResponse();

    expect('response' in result).toBe(true);
    if ('response' in result) expect(result.response.status).toBe(403);
  });

  it('a non-AuthError propagates rather than being flattened into a response', async () => {
    requireUser.mockRejectedValue(new Error('unexpected DB failure'));

    await expect(requireUserOrResponse()).rejects.toThrow('unexpected DB failure');
  });
});

describe('canAccessClientScopedObject', () => {
  beforeEach(() => {
    hasClientAccess.mockReset();
  });

  const INTERNAL_USER = { id: 'internal-1', email: 'op@rekreative.com', role: 'internal' as const };
  const CLIENT_USER = { id: 'client-user-1', email: 'client@rekreative.com', role: 'client' as const };

  it('internal → always true, never consults user_client_access, even for a null objectClientId', async () => {
    await expect(canAccessClientScopedObject(INTERNAL_USER, 'client-acme')).resolves.toBe(true);
    await expect(canAccessClientScopedObject(INTERNAL_USER, null)).resolves.toBe(true);
    expect(hasClientAccess).not.toHaveBeenCalled();
  });

  it('client + objectClientId is null (internal-scoped object) → false, never consults user_client_access', async () => {
    await expect(canAccessClientScopedObject(CLIENT_USER, null)).resolves.toBe(false);
    expect(hasClientAccess).not.toHaveBeenCalled();
  });

  it('client + a grant for the object\'s clientId → true', async () => {
    hasClientAccess.mockResolvedValue(true);
    await expect(canAccessClientScopedObject(CLIENT_USER, 'client-acme')).resolves.toBe(true);
    expect(hasClientAccess).toHaveBeenCalledWith('client-user-1', 'client-acme');
  });

  it('client + no grant for the object\'s clientId → false', async () => {
    hasClientAccess.mockResolvedValue(false);
    await expect(canAccessClientScopedObject(CLIENT_USER, 'client-other')).resolves.toBe(false);
  });
});

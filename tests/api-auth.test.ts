import { describe, expect, it, vi } from 'vitest';

const requireInternalUser = vi.fn();

vi.mock('@/lib/server/auth', () => ({
  requireInternalUser: (...args: unknown[]) => requireInternalUser(...args),
}));

const { requireInternalUserOrResponse } = await import('@/lib/server/api-auth');
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

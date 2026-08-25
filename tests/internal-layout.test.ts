import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * app/(internal)/layout.tsx's own auth branching — the dependency boundary
 * (requireInternalUser, next/navigation's redirect) is mocked; the real
 * layout function's try/catch/redirect logic runs for real. Calling the
 * layout function directly (not through React's renderer) never executes
 * its child components' own bodies/hooks (JSX is just element-tree
 * description until something actually renders it) — no need to mock
 * Sidebar/Topbar/ClientsProvider/CommandPalette/ConductorPanel at all.
 */

const requireInternalUser = vi.fn();
vi.mock('@/lib/server/auth', () => ({ requireInternalUser: (...args: unknown[]) => requireInternalUser(...args) }));

const redirectCalls: string[] = [];
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirectCalls.push(url);
    // Mirrors Next's real redirect(): a thrown, framework-recognized signal.
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
}));

const { default: InternalLayout } = await import('@/app/(internal)/layout');
const { AuthError } = await import('@/lib/server/auth-errors');

beforeEach(() => {
  requireInternalUser.mockReset();
  redirectCalls.length = 0;
});

describe('app/(internal)/layout.tsx', () => {
  it('unauthenticated → redirect(\'/login\')', async () => {
    requireInternalUser.mockRejectedValue(new AuthError(401, 'UNAUTHENTICATED'));

    await expect(InternalLayout({ children: 'child' })).rejects.toThrow();

    expect(redirectCalls).toEqual(['/login']);
  });

  it('authenticated client-role (NOT_INTERNAL) → also redirect(\'/login\') — no forbidden page exists yet, per this milestone\'s explicit scope', async () => {
    requireInternalUser.mockRejectedValue(new AuthError(403, 'NOT_INTERNAL'));

    await expect(InternalLayout({ children: 'child' })).rejects.toThrow();

    expect(redirectCalls).toEqual(['/login']);
  });

  it('a no-profile account (403 NO_PROFILE) is also denied, same as any other non-internal state', async () => {
    requireInternalUser.mockRejectedValue(new AuthError(403, 'NO_PROFILE'));

    await expect(InternalLayout({ children: 'child' })).rejects.toThrow();

    expect(redirectCalls).toEqual(['/login']);
  });

  it('internal → renders the shell with children, never redirects', async () => {
    requireInternalUser.mockResolvedValue({ id: 'user-1', email: 'operator@rekreative.com', role: 'internal' });

    const result = await InternalLayout({ children: 'child-marker' });

    expect(redirectCalls).toEqual([]);
    expect(result).toBeTruthy();
  });

  it('a non-AuthError propagates rather than being silently redirected away', async () => {
    requireInternalUser.mockRejectedValue(new Error('unexpected DB failure'));

    await expect(InternalLayout({ children: 'child' })).rejects.toThrow('unexpected DB failure');
    expect(redirectCalls).toEqual([]);
  });
});

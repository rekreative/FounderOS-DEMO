import { vi } from 'vitest';

/**
 * Global test default: every test resolves lib/server/auth.ts's helpers as
 * a real internal user, with no network/DB call — most of this suite is
 * about domain logic (a repo function, a route's business behavior), not
 * about auth itself, and Session Refresh + Internal Route Protection V1
 * wired requireInternalUserOrResponse() into ~51 API routes those tests
 * call directly.
 *
 * Tests that specifically exercise the auth boundary override this: either
 * `vi.mock('@/lib/server/auth', ...)` in their own file (which cleanly
 * replaces this default for that file only), or `vi.unmock('@/lib/server/auth')`
 * when they need the REAL module (e.g. to prove the real unauthenticated
 * chain rejects a request, or to test lib/server/auth.ts itself against
 * mocked lower-level dependencies).
 */
const TEST_INTERNAL_USER = {
  id: 'test-internal-user',
  email: 'test-internal@rekreative.com',
  role: 'internal' as const,
};

vi.mock('@/lib/server/auth', () => ({
  requireUser: vi.fn().mockResolvedValue(TEST_INTERNAL_USER),
  requireInternalUser: vi.fn().mockResolvedValue(TEST_INTERNAL_USER),
  requireClientAccess: vi.fn().mockResolvedValue(TEST_INTERNAL_USER),
}));

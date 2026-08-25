import { beforeAll, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

/**
 * Proves the real end-to-end wiring — requireInternalUserOrResponse() →
 * requireInternalUser() → requireUser() → getSupabaseUser() → Supabase
 * auth.getUser() — actually rejects an unauthenticated request to routes
 * the SaaS readiness audit previously proved were completely open. This
 * file exists specifically to show the opposite is now true — not the
 * helper tested in isolation (tests/api-auth.test.ts already covers that),
 * but the actual route handlers, called the same way tests/api-*.test.ts
 * already call them.
 *
 * next/headers is mocked to an empty cookie jar (same pattern used in
 * tests/smoke.test.ts's /login coverage) so getSupabaseUser() resolves to
 * "no session" without a real network call — there is no token in an empty
 * jar to validate.
 */
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], get: () => undefined, set: () => {} }),
}));
// Defeat the global "always internal" test default (tests/setup.ts) — this
// file specifically wants the REAL chain, unauthenticated, end to end.
vi.unmock('@/lib/server/auth');

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://protection-test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'protection-test-publishable-key';
});

describe('representative internal-human APIs reject an unauthenticated request (real chain, no mocked auth helper)', () => {
  it('GET /api/clients → 401', async () => {
    const { GET } = await import('@/app/api/clients/route');
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('GET /api/leads → 401', async () => {
    const { GET } = await import('@/app/api/leads/route');
    const res = await GET(new Request('http://x/api/leads'));
    expect(res.status).toBe(401);
  });

  it('GET /api/results → 401', async () => {
    const { GET } = await import('@/app/api/results/route');
    const res = await GET(new Request('http://x/api/results'));
    expect(res.status).toBe(401);
  });

  it('GET /api/meta-ads/campaigns → 401', async () => {
    const { GET } = await import('@/app/api/meta-ads/campaigns/route');
    const res = await GET(new Request('http://x/api/meta-ads/campaigns'));
    expect(res.status).toBe(401);
  });

  it('the manual (internal-human) commercial-events variant also requires auth — confirming the M2M/human split was applied correctly, not just at the middleware layer', async () => {
    const { POST } = await import('@/app/api/leads/[id]/commercial-events/route');
    const res = await POST(new Request('http://x/api/leads/lead-1/commercial-events', { method: 'POST', body: '{}' }), {
      params: { id: 'lead-1' },
    });
    expect(res.status).toBe(401);
  });

  it('the M2M-bearer-keyed commercial-events route is UNCHANGED — still governed by its bearer key, not by this new auth layer', async () => {
    const originalKey = process.env.MAKE_EVENTS_API_KEY;
    process.env.MAKE_EVENTS_API_KEY = 'test-make-events-key';
    try {
      const { POST } = await import('@/app/api/leads/commercial-events/route');
      const res = await POST(new Request('http://x/api/leads/commercial-events', { method: 'POST', body: '{}' }));
      // No Authorization header at all: rejected by the pre-existing bearer
      // check, not by requireInternalUserOrResponse() (which this route
      // never imports) — 401, same as it always was.
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBeUndefined(); // the M2M auth module's own error shape, not AuthError's
    } finally {
      if (originalKey === undefined) delete process.env.MAKE_EVENTS_API_KEY;
      else process.env.MAKE_EVENTS_API_KEY = originalKey;
    }
  });
});

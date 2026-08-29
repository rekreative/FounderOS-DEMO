import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * lib/supabase/middleware-session.ts's cookie-transfer mechanics — mocked
 * @supabase/ssr, no real network. Proves: getAll reads request cookies,
 * setAll's refreshed cookies land on the RETURNED response (not just some
 * internal state), getClaims verifies identity without getUser's per-request
 * Auth-server round trip, and an error/no-claims result is treated as no
 * session.
 */

let capturedCookieMethods: { getAll: () => unknown; setAll: (cookies: unknown[], headers: Record<string, string>) => void } | null = null;
const getClaims = vi.fn();
const getUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: typeof capturedCookieMethods }) => {
    capturedCookieMethods = options.cookies;
    return { auth: { getClaims, getUser } };
  },
}));

const { refreshMiddlewareSession } = await import('@/lib/supabase/middleware-session');

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  getClaims.mockReset();
  getUser.mockReset();
  capturedCookieMethods = null;
});

function req(cookieHeader?: string): NextRequest {
  return new NextRequest(new URL('/clients', 'http://localhost:4100'), {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

describe('refreshMiddlewareSession', () => {
  it('reads incoming cookies via getAll and returns the resolved user', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
    getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } }, error: null });

    const result = await refreshMiddlewareSession(req('sb-access-token=abc'));

    expect(result.user).toEqual({ id: 'user-1' });
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
    expect(capturedCookieMethods).toBeTruthy();
    // getAll must genuinely read from the request's own cookie jar, not a
    // hardcoded/empty stand-in.
    const cookies = capturedCookieMethods!.getAll() as { name: string; value: string }[];
    expect(cookies.some((c) => c.name === 'sb-access-token' && c.value === 'abc')).toBe(true);
  });

  it('refreshed cookies written via setAll land on the RETURNED response, not just internal state', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
    getClaims.mockImplementation(async () => {
      // Simulate @supabase/ssr refreshing the session mid-call, exactly as
      // its own JSDoc describes - setAll must be invoked before getClaims()
      // resolves.
      capturedCookieMethods!.setAll(
        [{ name: 'sb-access-token', value: 'refreshed-value', options: { path: '/' } }],
        {},
      );
      return { data: { claims: { sub: 'user-1' } }, error: null };
    });

    const result = await refreshMiddlewareSession(req());

    const setCookie = result.response.cookies.get('sb-access-token');
    expect(setCookie?.value).toBe('refreshed-value');
  });

  it('an auth error is treated as no session (user: null), never surfaced as a thrown error', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
    getClaims.mockResolvedValue({ data: null, error: { message: 'invalid token' } });

    const result = await refreshMiddlewareSession(req('sb-access-token=garbage'));

    expect(result.user).toBeNull();
  });

  it('no cookies at all resolves to user: null without throwing', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
    getClaims.mockResolvedValue({ data: null, error: null });

    const result = await refreshMiddlewareSession(req());

    expect(result.user).toBeNull();
    expect(result.response).toBeTruthy();
  });

  it('verified claims without a subject are rejected as no identity', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
    getClaims.mockResolvedValue({ data: { claims: { exp: 4_102_444_800 } }, error: null });

    const result = await refreshMiddlewareSession(req('sb-access-token=missing-sub'));

    expect(result.user).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it('missing NEXT_PUBLIC_SUPABASE_URL throws a clear, explicit error naming the variable', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';

    await expect(refreshMiddlewareSession(req())).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL is not set/);
  });
});

import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { M2M_PATHS } from '@/lib/server/m2m-routes';

/**
 * Middleware's own routing/redirect/M2M-exclusion decisions — mocked
 * Supabase session refresh, no real network, no real DB. Proves middleware
 * never queries profiles/role (there is no mock for that at all — a
 * regression that started doing so would need a new mock this file doesn't
 * provide, which would surface as a failure) and never touches the
 * Supabase client for M2M paths at all (call-count assertions, not just
 * "still returns 200").
 */

const refreshMiddlewareSession = vi.fn();

vi.mock('@/lib/supabase/middleware-session', () => ({
  refreshMiddlewareSession: (...args: unknown[]) => refreshMiddlewareSession(...args),
}));

const { middleware } = await import('@/middleware');

function req(pathname: string, init?: { method?: string }): NextRequest {
  return new NextRequest(new URL(pathname, 'http://localhost:4100'), init);
}

function mockSession(user: { id: string } | null) {
  refreshMiddlewareSession.mockImplementation(async (request: NextRequest) => ({
    response: NextResponse.next({ request }),
    user,
  }));
}

const originalToken = process.env.FOUNDER_OS_ACCESS_TOKEN;

beforeEach(() => {
  refreshMiddlewareSession.mockReset();
  // Legacy gate must be a no-op for every test in this file unless a test
  // explicitly opts into exercising it — this file is about the Supabase
  // perimeter, not the legacy gate (already covered by access-gate.test.ts).
  delete process.env.FOUNDER_OS_ACCESS_TOKEN;
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.FOUNDER_OS_ACCESS_TOKEN;
  else process.env.FOUNDER_OS_ACCESS_TOKEN = originalToken;
});

describe('PUBLIC', () => {
  it('unauthenticated /login is allowed — no redirect', async () => {
    mockSession(null);
    const res = await middleware(req('/login'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(308);
  });

  it('never redirects /login to /login — no loop possible, even with no session', async () => {
    mockSession(null);
    const res = await middleware(req('/login'));
    const location = res.headers.get('location');
    if (location) expect(new URL(location).pathname).not.toBe('/login');
  });
});

describe('INTERNAL PAGE — identity presence only, role NOT checked here', () => {
  it('unauthenticated / redirects to /login', async () => {
    mockSession(null);
    const res = await middleware(req('/'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('unauthenticated /clients redirects to /login', async () => {
    mockSession(null);
    const res = await middleware(req('/clients'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('a valid Supabase identity is allowed through /clients — middleware does not itself check role', async () => {
    mockSession({ id: 'user-1' }); // no role information anywhere in this mock
    const res = await middleware(req('/clients'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('/me no longer has any special-case exemption — the temporary diagnostic page is gone, and it now redirects to /login like any other protected page with no session', async () => {
    mockSession(null);
    const res = await middleware(req('/me'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });
});

describe('INTERNAL API — middleware never replaces Route Handler auth semantics', () => {
  it('unauthenticated /api/clients is NOT redirected — a redirect would break the JSON 401 contract the route itself must return', async () => {
    mockSession(null);
    const res = await middleware(req('/api/clients'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).not.toBe(307);
  });

  it('a valid identity on /api/leads passes through unmodified', async () => {
    mockSession({ id: 'user-1' });
    const res = await middleware(req('/api/leads'));
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('M2M — exact paths only, never touch Supabase', () => {
  it.each([...M2M_PATHS])('%s passes through middleware without ever invoking Supabase session refresh', async (pathname) => {
    const res = await middleware(req(pathname, { method: 'POST' }));
    expect(refreshMiddlewareSession).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBeNull();
  });

  it('/api/leads/123/commercial-events (the manual, internal-human variant) is NOT treated as M2M — Supabase refresh IS invoked for it', async () => {
    mockSession(null);
    await middleware(req('/api/leads/123/commercial-events', { method: 'POST' }));
    expect(refreshMiddlewareSession).toHaveBeenCalledTimes(1);
  });

  it('a prefix match must not accidentally sweep in a human route — /api/leads/whatsapp-events-report (hypothetical near-miss) still goes through Supabase', async () => {
    mockSession(null);
    await middleware(req('/api/leads/whatsapp-events-report'));
    expect(refreshMiddlewareSession).toHaveBeenCalledTimes(1);
  });
});

describe('M2M bypasses the legacy FOUNDER_OS_ACCESS_TOKEN gate too — the critical ordering fix', () => {
  const originalToken = process.env.FOUNDER_OS_ACCESS_TOKEN;

  beforeEach(() => {
    process.env.FOUNDER_OS_ACCESS_TOKEN = 'configured-deployment-secret';
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.FOUNDER_OS_ACCESS_TOKEN;
    else process.env.FOUNDER_OS_ACCESS_TOKEN = originalToken;
  });

  it.each([...M2M_PATHS])(
    'with FOUNDER_OS_ACCESS_TOKEN configured and NO founder_os_access cookie, %s still reaches the M2M perimeter unchanged — never the legacy challenge page, never Supabase',
    async (pathname) => {
      const res = await middleware(req(pathname, { method: 'POST' }));

      // Not the legacy gate's 401 HTML challenge page (a bare
      // NextResponse.next() passthrough has no content-type header at all,
      // unlike the challenge page's explicit 'text/html; charset=utf-8' —
      // null here is itself part of the proof, not an oversight).
      expect(res.status).not.toBe(401);
      expect(res.headers.get('content-type')).not.toBe('text/html; charset=utf-8');
      // Not a redirect to set the legacy cookie either.
      expect(res.headers.get('location')).toBeNull();
      // And Supabase was never reached — full bypass, not just "not blocked".
      expect(refreshMiddlewareSession).not.toHaveBeenCalled();
    },
  );

  it('sanity check: the same configured token DOES still challenge a human page with no cookie — proves the legacy gate itself is genuinely still active, not accidentally disabled by the reordering', async () => {
    const res = await middleware(req('/clients'));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(refreshMiddlewareSession).not.toHaveBeenCalled(); // never got past the legacy gate
  });
});

describe('PUBLIC DEPLOYMENT STATUS CHECKS — /api/health and /api/ready, exact match only, never blocked by any layer', () => {
  it.each(['/api/health', '/api/ready'])('unauthenticated %s passes through — no redirect, no challenge, Supabase never invoked', async (pathname) => {
    mockSession(null);
    const res = await middleware(req(pathname));
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).not.toBe(401);
    expect(refreshMiddlewareSession).not.toHaveBeenCalled();
  });

  describe('with FOUNDER_OS_ACCESS_TOKEN configured and no cookie', () => {
    const originalToken = process.env.FOUNDER_OS_ACCESS_TOKEN;

    beforeEach(() => {
      process.env.FOUNDER_OS_ACCESS_TOKEN = 'configured-deployment-secret';
    });

    afterEach(() => {
      if (originalToken === undefined) delete process.env.FOUNDER_OS_ACCESS_TOKEN;
      else process.env.FOUNDER_OS_ACCESS_TOKEN = originalToken;
    });

    it.each(['/api/health', '/api/ready'])('%s still passes through — never the legacy challenge page', async (pathname) => {
      const res = await middleware(req(pathname));
      expect(res.status).not.toBe(401);
      expect(res.headers.get('content-type')).not.toBe('text/html; charset=utf-8');
      expect(refreshMiddlewareSession).not.toHaveBeenCalled();
    });
  });

  it.each(['/api/health/foo', '/api/healthcheck', '/api/ready/foo', '/api/readiness'])(
    'a near-miss path does not become public — %s still goes through the Supabase perimeter',
    async (pathname) => {
      mockSession(null);
      await middleware(req(pathname));
      expect(refreshMiddlewareSession).toHaveBeenCalledTimes(1);
    },
  );
});

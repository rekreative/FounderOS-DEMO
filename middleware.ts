import { NextRequest, NextResponse } from 'next/server';
import { challengePage, gateDecision, GATE_COOKIE } from '@/lib/access-gate';
import { refreshMiddlewareSession } from '@/lib/supabase/middleware-session';
import { M2M_PATHS } from '@/lib/server/m2m-routes';

/**
 * Three layers, composed, never merged — and checked in THIS order
 * deliberately:
 *
 * 1. M2M exclusion — exact paths only (lib/server/m2m-routes.ts), checked
 *    FIRST, before either protection layer below. This is load-bearing, not
 *    cosmetic: the legacy gate (layer 2) fails closed when
 *    FOUNDER_OS_ACCESS_TOKEN is configured, and Make/Meta/WhatsApp/ManyChat
 *    callers never carry a founder_os_access cookie — if the M2M check ran
 *    after the legacy gate, turning that token on would silently start
 *    blocking every M2M integration. Checking M2M first means these exact
 *    paths bypass BOTH the legacy gate and the Supabase human-session
 *    perimeter unconditionally; their only security mechanism is their own
 *    bearer/shared-secret check inside the Route Handler.
 * 2. The legacy shared-token gate (lib/access-gate.ts) — an OPTIONAL,
 *    OUTER deployment perimeter ("is this deployment publicly reachable at
 *    all"), active only when FOUNDER_OS_ACCESS_TOKEN is set. It never
 *    satisfies or substitutes for Supabase authentication.
 * 3. The Supabase human-session perimeter — identity PRESENCE only ("is
 *    there a valid Supabase session"), refreshed on every request. Role
 *    authorization (profiles.role === 'internal') is deliberately NOT
 *    checked here — this runtime can't reach Postgres (Edge, no pg), and
 *    checking it here would duplicate, not replace, the authoritative
 *    checks in app/(internal)/layout.tsx and lib/server/api-auth.ts.
 *
 * Separately from the three layers above: /api/health (PUBLIC_HEALTH_PATH)
 * is an exact-match public exception, checked right after layer 1. It is
 * NOT an M2M integration (deliberately not added to M2M_PATHS) — it exists
 * so a deployment platform's health probe, which carries neither a
 * founder_os_access cookie nor a Supabase session, is never blocked by the
 * optional legacy gate (layer 2) when FOUNDER_OS_ACCESS_TOKEN is configured.
 */

// The one page middleware must never redirect away from, even with no
// session: /login is genuinely public.
const LOGIN_PATH = '/login';

// Deployment health check (see app/api/health/route.ts) — exact match only,
// same discipline as M2M_PATHS. Must stay reachable with zero auth.
const PUBLIC_HEALTH_PATH = '/api/health';

export async function middleware(req: NextRequest) {
  // ── Layer 1: M2M exclusion, checked before anything else ──────────────
  if (M2M_PATHS.has(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // ── Public health check, exact match only ──────────────────────────────
  if (req.nextUrl.pathname === PUBLIC_HEALTH_PATH) {
    return NextResponse.next();
  }

  // ── Layer 2: legacy outer gate, unchanged ─────────────────────────────
  const decision = gateDecision({
    token: process.env.FOUNDER_OS_ACCESS_TOKEN,
    cookie: req.cookies.get(GATE_COOKIE)?.value ?? null,
    queryToken: req.nextUrl.searchParams.get('token'),
  });

  switch (decision.kind) {
    case 'set-cookie': {
      // strip ?token= from the URL so it never lingers in the address bar
      const clean = req.nextUrl.clone();
      clean.searchParams.delete('token');
      const res = NextResponse.redirect(clean);
      res.cookies.set(GATE_COOKIE, decision.value, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.nextUrl.protocol === 'https:',
        maxAge: 60 * 60 * 24 * 30, // re-enter monthly
        path: '/',
      });
      return res;
    }
    case 'challenge':
      return new NextResponse(challengePage(), {
        status: 401,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    case 'open':
    case 'pass':
      break; // fall through to layer 3
  }

  // ── Layer 3: Supabase session presence + refresh ───────────────────────
  const { response, user } = await refreshMiddlewareSession(req);

  const isApiRoute = req.nextUrl.pathname.startsWith('/api/');
  const isLoginPage = req.nextUrl.pathname === LOGIN_PATH;

  if (!user && !isApiRoute && !isLoginPage) {
    // Human page request, no session at all: redirect before rendering a
    // doomed page tree. Internal APIs are never redirected here — a
    // redirect would break their JSON-401 contract; requireInternalUserOrResponse()
    // in the route itself is what returns the correct 401, whether or not
    // a session exists.
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.png$|.*\\.svg$).*)'],
};

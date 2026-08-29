import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware-only Supabase session refresh — identity/session plumbing,
 * NOT authorization. Never queries `profiles`, never uses
 * SUPABASE_SECRET_KEY — only the same public URL/publishable key
 * lib/supabase/client.ts and lib/supabase/server.ts already use. Refreshing
 * a session and deciding role are different questions; this module answers
 * only the first one (see lib/server/auth.ts / lib/server/api-auth.ts for
 * the second, applied in the internal layout and API routes).
 *
 * getClaims() verifies the JWT signature and expiry instead of trusting the
 * cookie via getSession(). With this installation's asymmetric ES256 key,
 * verification uses the project's cached public JWKS and avoids getUser()'s
 * Auth-server request on every middleware invocation. getClaims() still
 * loads the session first, so an expired token can be refreshed and the new
 * cookies are written through setAll below before the response is returned.
 * Authoritative authorization remains in lib/server/auth.ts, which still
 * calls getUser() and reads the profile role from Postgres.
 *
 * setAll's response reconstruction: cookies must be set on BOTH the
 * request (so this same invocation's downstream reads see them) and a
 * freshly created NextResponse bound to that updated request (so the
 * browser receives them) — this is @supabase/ssr's own documented pattern
 * for Next.js middleware, verified against this installed version's actual
 * cookie-method types (CookieMethodsServer), not copied from generic docs.
 */

function requirePublicEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill in the Supabase project values ` +
        '(Supabase Dashboard → Project Settings → API).',
    );
  }
  return value;
}

export type MiddlewareSessionResult = {
  /** The response middleware should return — carries any refreshed cookies. */
  response: NextResponse;
  /** null for both "no session" and "session invalid/error" — callers never
   *  need to distinguish those two for a presence-only check. */
  user: { id: string } | null;
};

export async function refreshMiddlewareSession(request: NextRequest): Promise<MiddlewareSessionResult> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    requirePublicEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    requirePublicEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Called before `response` is returned, per the module comment above.
  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims.sub;

  return { response, user: error || !subject ? null : { id: subject } };
}

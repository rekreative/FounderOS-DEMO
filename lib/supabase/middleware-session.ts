import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';

/**
 * Middleware-only Supabase session refresh — identity/session plumbing,
 * NOT authorization. Never queries `profiles`, never uses
 * SUPABASE_SECRET_KEY — only the same public URL/publishable key
 * lib/supabase/client.ts and lib/supabase/server.ts already use. Refreshing
 * a session and deciding role are different questions; this module answers
 * only the first one (see lib/server/auth.ts / lib/server/api-auth.ts for
 * the second, applied in the internal layout and API routes).
 *
 * getUser() — never getSession() — is the only safe check: getSession()
 * would trust the JWT already sitting in the cookie without revalidating
 * it against Supabase's Auth server. Calling getUser() is also what
 * triggers @supabase/ssr's lazy session load and, if the access token is
 * near/past expiry, the refresh — the refreshed tokens are written back via
 * setAll below, which is why getUser() must be called BEFORE this
 * function's response is returned (a refresh completing after the response
 * is committed can't be persisted — see createServerClient's own JSDoc in
 * the installed @supabase/ssr package).
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
  user: User | null;
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
  const { data, error } = await supabase.auth.getUser();

  return { response, user: error ? null : data.user };
}

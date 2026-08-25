import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-only Supabase client factory (identity/session plumbing — no
 * role/profile queries, no authorization decisions). Must be called fresh
 * inside every Server Component / Route Handler / Server Action — never
 * memoized at module scope. Each instance is bound to that one request's
 * cookies via next/headers's cookies(); a module-level singleton would leak
 * one request's session into a concurrent request on a shared server
 * process.
 *
 * Uses the current (non-deprecated) getAll/setAll cookie interface —
 * @supabase/ssr's get/set/remove methods are deprecated and scheduled for
 * removal in its next major version.
 *
 * setAll's writes are wrapped in try/catch: next/headers's cookies() only
 * permits .set() from Route Handlers/Server Actions/Middleware — a plain
 * Server Component render throws on it. This is @supabase/ssr's own
 * documented pattern for that case (createServerClient's JSDoc: "Not all
 * frameworks allow setting cookies ... setAll can be omitted" in those
 * cases). Nothing in this milestone depends on a
 * refreshed session actually being persisted mid-render — that becomes load
 * -bearing once the route-protection milestone wires session refresh into
 * middleware.
 */

function readPublicEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill in the Supabase project values ` +
        '(Supabase Dashboard → Project Settings → API).',
    );
  }
  return value;
}

export function getSupabaseServerClient() {
  // Validated before cookies() runs: cookies() only works inside a real
  // Next.js request context (it throws when called from a plain test
  // runner), so checking env first keeps "env is missing" a clean, testable
  // error instead of a confusing crash inside next/headers.
  const url = readPublicEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = readPublicEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  const cookieStore = cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called during a Server Component render, which cannot write
          // cookies — safe to ignore here (see module comment above).
        }
      },
    },
  });
}

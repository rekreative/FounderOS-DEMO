import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-only Supabase client (identity/session plumbing — no DB queries,
 * no authorization decisions; see lib/server/auth.ts once the authorization
 * milestone adds it). createBrowserClient() already caches a singleton
 * internally whenever it detects a browser context (see
 * @supabase/ssr's createBrowserClient.js: isSingleton defaults to true when
 * isBrowser() is true), so calling this repeatedly returns the same client
 * — no extra caching needed here.
 *
 * NEXT_PUBLIC_* values MUST be referenced as static, literal
 * `process.env.NEXT_PUBLIC_X` expressions — Next.js inlines them at build
 * time via a source-text replacement that only recognizes that exact
 * literal form. An earlier version of this file read them through a shared
 * `readPublicEnv(name)` helper using `process.env[name]` (name being a
 * runtime variable) — that dynamic access can't be statically analyzed, so
 * Next left it unreplaced in the browser bundle. In the browser
 * process.env is an empty polyfill stub, not the real populated Node
 * object, so the lookup silently resolved to undefined at runtime: manual
 * QA hit "NEXT_PUBLIC_SUPABASE_URL is not set" even though the value was
 * genuinely set in .env.local. lib/supabase/server.ts and
 * lib/supabase/admin.ts use the same-shaped dynamic helper safely — both
 * are server/CLI-only, where process.env is the real, fully dynamic Node
 * object, so no equivalent bug exists there.
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

export function getSupabaseBrowserClient() {
  const url = requirePublicEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = requirePublicEnv(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  return createBrowserClient(url, key);
}

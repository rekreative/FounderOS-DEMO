import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-only Supabase client (identity/session plumbing — no DB queries,
 * no authorization decisions; see lib/server/auth.ts once the authorization
 * milestone adds it). createBrowserClient() already caches a singleton
 * internally whenever it detects a browser context (see
 * @supabase/ssr's createBrowserClient.js: isSingleton defaults to true when
 * isBrowser() is true), so calling this repeatedly returns the same client
 * — no extra caching needed here.
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

export function getSupabaseBrowserClient() {
  return createBrowserClient(
    readPublicEnv('NEXT_PUBLIC_SUPABASE_URL'),
    readPublicEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  );
}

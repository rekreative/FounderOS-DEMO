import { createClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase Admin client — service-role (SUPABASE_SECRET_KEY)
 * access to the Auth Admin API (createUser, listUsers, deleteUser, ...).
 * Uses @supabase/supabase-js's plain createClient directly, NOT
 * @supabase/ssr's createBrowserClient/createServerClient — those exist to
 * bind a client to a *user's* cookie-based session; this client has no user
 * session at all, only a privileged service credential, so the cookie-aware
 * SSR wrapper is the wrong primitive here.
 *
 * persistSession/autoRefreshToken/detectSessionInUrl are all false: there is
 * no session to persist or refresh, and this must never attempt to read a
 * session out of a URL (that's a browser-flow concern this client has no
 * business with).
 *
 * Reusable beyond this milestone's bootstrap script — the future invite
 * flow needs this exact same client for inviteUserByEmail().
 *
 * Server-only boundary: no `import 'server-only'` — that package isn't
 * installed anywhere in this repo (verified: absent from node_modules and
 * package.json) and adding it here would be an unjustified new dependency
 * for a boundary this codebase already relies on elsewhere without it
 * (lib/supabase/server.ts, every lib/server/*-repo.ts). SUPABASE_SECRET_KEY
 * is never NEXT_PUBLIC_-prefixed, so even an accidental import into a
 * Client Component would find process.env.SUPABASE_SECRET_KEY undefined in
 * the browser bundle (Next only inlines NEXT_PUBLIC_* vars client-side) —
 * the eager validation below throws immediately rather than leaking
 * anything, even in a mistaken-import scenario.
 */

function readEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'SUPABASE_SECRET_KEY'): string {
  const value = process.env[name];
  if (!value) {
    // Names the variable only — never a value, for any variable, ever.
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill in the Supabase project values ` +
        '(Supabase Dashboard → Project Settings → API).',
    );
  }
  return value;
}

export function getSupabaseAdminClient() {
  return createClient(readEnv('NEXT_PUBLIC_SUPABASE_URL'), readEnv('SUPABASE_SECRET_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

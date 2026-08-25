import { getSupabaseServerClient } from './server';

/**
 * Low-level, server-only identity lookup — session plumbing, not
 * authorization. Deliberately thin: no redirects, no 401/403 handling, no
 * profiles/user_client_access query. requireUser() / requireInternalUser()
 * / requireClientAccess() (built on top of this, plus a profiles lookup)
 * belong to the authorization milestone, not this one.
 *
 * Uses getUser(), never getSession(): getSession() only decodes the JWT
 * already sitting in the cookie without revalidating it against Supabase's
 * Auth server, so it can return a "valid-looking" session for a token that
 * was tampered with or belongs to a since-deleted/banned user. getUser()
 * revalidates server-side on every call and is the only one safe to ever
 * gate a decision on.
 */
export async function getSupabaseUser() {
  const supabase = getSupabaseServerClient();
  return supabase.auth.getUser();
}

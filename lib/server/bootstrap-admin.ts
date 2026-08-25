import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { query } from './db';
import { getProfileRole } from './profiles-repo';

/**
 * Reusable server/CLI logic for provisioning the first (or Nth) REKREATIVE
 * internal account — Supabase Auth user + a matching profiles(role=
 * 'internal') row. Consumed by scripts/seed-admin.ts; kept separate from
 * that script so the decision logic is unit-testable without a process-exit
 * CLI wrapper around it.
 *
 * There is no distributed transaction between the Supabase Auth API and
 * PostgreSQL — a createUser() that succeeds followed by a profile INSERT
 * that fails leaves a real auth.users row with no profile. This is
 * deliberately NOT rolled back by deleting the newly created auth user:
 * that "cleanup" would itself be an uncertain operation racing the same
 * network/DB conditions that caused the failure, and deleting a real Auth
 * identity based on an ambiguous failure is not obviously safer than
 * leaving it. Instead, re-running this function against the same email is
 * the recovery path — it detects the existing auth user (via the
 * email_exists/user_already_exists error from createUser) and completes the
 * missing profile insert. Idempotent repair, not defensive deletion.
 */

export type BootstrapAdminResult =
  | { outcome: 'CREATED'; userId: string; email: string }
  | { outcome: 'REPAIRED'; userId: string; email: string }
  | { outcome: 'ALREADY_INTERNAL'; userId: string; email: string }
  | { outcome: 'REFUSED_ROLE_CONFLICT'; userId: string; email: string; existingRole: string };

const ALREADY_EXISTS_CODES = new Set(['email_exists', 'user_already_exists']);

/**
 * Resolves an existing auth.users id by email. There is no getUserByEmail()
 * on the installed @supabase/supabase-js Admin API (verified against
 * node_modules/@supabase/auth-js's GoTrueAdminApi.d.ts — only listUsers()
 * and getUserById() exist) — listUsers() is the only supported way to
 * resolve an id from an email, so this paginates it rather than inventing
 * an unsupported method. The 50-page cap (10,000 users at 200/page) is a
 * safety bound against a runaway loop, not an expected ceiling for
 * REKREATIVE's internal team size.
 */
async function findUserIdByEmail(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  normalizedEmail: string,
): Promise<string> {
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === normalizedEmail);
    if (match) return match.id;
    if (data.users.length < perPage) break;
  }
  throw new Error(
    `createUser reported the email already exists, but no matching user was found via listUsers — cannot resolve an id to repair`,
  );
}

/**
 * CASE 1 (email unknown to Supabase Auth): creates the auth user
 *   (email_confirm: true — see the login-milestone design rationale: an
 *   operator-created account with a real, known password has no need for
 *   the email-confirmation round trip) and inserts profiles(role=internal).
 *   → CREATED
 * CASE 2 (auth user exists, no profiles row): never re-creates the auth
 *   user; inserts the missing profiles row. → REPAIRED (also the recovery
 *   path for a prior run's partial failure, per the module comment above)
 * CASE 3 (auth user exists, profile role already 'internal'): no write at
 *   all. → ALREADY_INTERNAL
 * CASE 4/5 (auth user exists, profile role is 'client' OR any other
 *   non-'internal' value): refuses outright, before any write. Never
 *   silently promotes a client — or any unrecognized role — to internal.
 *   → REFUSED_ROLE_CONFLICT
 */
export async function bootstrapAdminUser(email: string, password: string): Promise<BootstrapAdminResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error('ADMIN_EMAIL is not set');
  if (!password) throw new Error('ADMIN_PASSWORD is not set');

  const admin = getSupabaseAdminClient();

  const created = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
  });

  let userId: string;
  let wasRepairPath = false;

  if (created.error) {
    if (!ALREADY_EXISTS_CODES.has(created.error.code ?? '')) {
      throw created.error;
    }
    userId = await findUserIdByEmail(admin, normalizedEmail);
    wasRepairPath = true;
  } else {
    userId = created.data.user.id;
  }

  const existingRole = await getProfileRole(userId);

  if (existingRole === null) {
    await query('INSERT INTO profiles (user_id, role) VALUES ($1, $2)', [userId, 'internal']);
    return { outcome: wasRepairPath ? 'REPAIRED' : 'CREATED', userId, email: normalizedEmail };
  }

  if (existingRole === 'internal') {
    return { outcome: 'ALREADY_INTERNAL', userId, email: normalizedEmail };
  }

  // CASE 4 (existingRole === 'client') and CASE 5 (anything else
  // unrecognized) collapse into one refusal path deliberately: the safety
  // rule is "never touch a role that isn't already internal," not a
  // hardcoded list of specific roles to distrust.
  return { outcome: 'REFUSED_ROLE_CONFLICT', userId, email: normalizedEmail, existingRole };
}

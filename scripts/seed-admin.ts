import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvLocal } from '../lib/creds';
import { closePool } from '../lib/server/db';
import { bootstrapAdminUser } from '../lib/server/bootstrap-admin';

/**
 * First-internal-user bootstrap CLI — `npm run db:seed-admin`. Thin wrapper
 * around lib/server/bootstrap-admin.ts's decision logic: this file owns env
 * loading, safe console output, and the process exit code; all provisioning
 * logic lives in the reusable, unit-testable module it calls.
 *
 * Prints ONLY: the email, the resolved user id, and the outcome. NEVER the
 * password, NEVER SUPABASE_SECRET_KEY, and never a raw thrown error object
 * (which could echo either) — every error path below constructs its own
 * fixed-shape message rather than forwarding `error.message` verbatim,
 * since a Postgres or Auth API error could in principle embed input we
 * don't want to risk surfacing.
 */

// Same fallback pattern as scripts/seed-backend-v1.ts / lib/server/migrate.ts:
// this runs standalone via tsx, so env vars only present in .env.local (not
// already exported in the shell) need the same reader lib/creds.ts uses
// elsewhere. process.env still wins when already set (e.g. CI).
function loadEnvFallback(name: string): void {
  if (!process.env[name]) {
    const value = readEnvLocal()[name];
    if (value) process.env[name] = value;
  }
}

for (const name of ['DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'ADMIN_EMAIL', 'ADMIN_PASSWORD']) {
  loadEnvFallback(name);
}

// Exported (undecorated by the isDirectRun guard below) so tests can
// exercise the console-output/exit-code mapping directly, without
// triggering a CLI run on import — same convention lib/server/migrate.ts
// already documents and uses for the identical reason.
export async function run(): Promise<number> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email) {
    console.error('ADMIN_EMAIL is not set. Set it temporarily in .env.local, run this script, then remove it.');
    return 1;
  }
  if (!password) {
    console.error('ADMIN_PASSWORD is not set. Set it temporarily in .env.local, run this script, then remove it.');
    return 1;
  }

  const result = await bootstrapAdminUser(email, password);

  switch (result.outcome) {
    case 'CREATED':
      console.log(`CREATED — ${result.email} (${result.userId}) is now provisioned as internal.`);
      return 0;
    case 'REPAIRED':
      console.log(
        `REPAIRED — ${result.email} (${result.userId}) already existed in Supabase Auth with no profile; ` +
          'the missing internal profile has been created.',
      );
      return 0;
    case 'ALREADY_INTERNAL':
      console.log(`ALREADY_INTERNAL — ${result.email} (${result.userId}) is already provisioned as internal. No change made.`);
      return 0;
    case 'REFUSED_ROLE_CONFLICT':
      console.error(
        `REFUSED_ROLE_CONFLICT — ${result.email} (${result.userId}) already has role "${result.existingRole}". ` +
          'This script will never change an existing role to internal. No change made.',
      );
      return 1;
  }
}

const isDirectRun =
  process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  run()
    .then(async (exitCode) => {
      await closePool();
      process.exit(exitCode);
    })
    .catch(async (error) => {
      // Fixed message only — never error.message/error.stack verbatim, in
      // case a thrown error object embeds the password or secret key. The
      // error's constructor name alone (e.g. "AuthApiError", "Error") is a
      // safe, zero-content debugging hint — never a message string.
      const kind = error instanceof Error ? error.constructor.name : typeof error;
      console.error(
        `Bootstrap failed (${kind}). Check DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, and SUPABASE_SECRET_KEY are all valid.`,
      );
      await closePool();
      process.exit(1);
    });
}

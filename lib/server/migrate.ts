import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { readEnvLocal } from '../creds';
import { getSslConfig } from './db';

/**
 * The smallest safe migration runner for Backend V1 — no framework. Applies
 * every lib/server/migrations/NNNN_*.sql file in filename order, tracking
 * what already ran in a schema_migrations table so re-running is a no-op for
 * anything already applied. Invoked explicitly via `npm run db:migrate` —
 * never from app/route code or page rendering. Exports its building blocks
 * (undecorated by the direct-run guard at the bottom) so tests can exercise
 * file discovery and the apply loop without triggering a CLI run on import.
 */

export const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export function resolveDatabaseUrl(): string {
  // Plain Next.js `dev`/`build` loads .env.local automatically; this script
  // runs standalone via tsx, so it falls back to the same .env.local reader
  // lib/creds.ts already uses elsewhere in the repo (no dotenv dependency
  // needed). process.env still wins when it's already set (e.g. CI).
  const url = process.env.DATABASE_URL ?? readEnvLocal().DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill in DATABASE_URL.',
    );
  }
  return url;
}

/**
 * Standalone-CLI-only CA resolution, mirroring resolveDatabaseUrl()'s exact
 * precedence: process.env first (authoritative in Railway/CI), then
 * .env.local for local dev. lib/server/db.ts's getSslConfig() stays
 * unchanged for the web application - Next.js's own dev/build already loads
 * .env.local into process.env before any app code runs, so that path needs
 * no fallback of its own. A standalone script run via tsx has no such
 * auto-loading, so migrate.ts and scripts/register-installation.ts both
 * resolve their CA through this instead of reading process.env directly -
 * otherwise a CA that exists only in .env.local would be silently dropped,
 * downgrading a real Supabase connection to unverified TLS with no error or
 * warning. Never logs its result - callers only ever pass it straight into
 * getSslConfig().
 */
export function resolveSupabaseCaPem(): string | undefined {
  return process.env.SUPABASE_CA_PEM || readEnvLocal().SUPABASE_CA_PEM || undefined;
}

export function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort(); // filenames are zero-padded (0001_, 0002_, ...) — lexicographic sort is deterministic order
}

/** Applies every not-yet-applied migration on `client`. Returns the filenames actually run. */
export async function applyMigrations(client: Client): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (await client.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id),
  );

  const ran: string[] = [];
  for (const file of listMigrationFiles()) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
    } catch {
      await client.query('ROLLBACK');
      // Never embed the raw underlying error (it can carry SQL text, a
      // constraint/column name, or a driver-level detail) - the migration
      // filename alone is enough for an operator to go fix the file, and is
      // the only detail safe to surface from this catch.
      throw new Error(`Migration ${file} failed and was rolled back.`);
    }
  }
  return ran;
}

/**
 * Pure config-building step, kept separate from `new Client(...)` so tests
 * can assert on the exact options without constructing a real client or
 * dialing any database. Reuses lib/server/db.ts's getSslConfig() exactly -
 * ssl is included only when a CA is available, and rejectUnauthorized is
 * always true, never false - so this one-off migration Client gets the same
 * verified-TLS Supabase Session Pooler connection the app's own pg.Pool
 * already uses (see docs/deployment.md's Supabase TLS section). The CA
 * itself comes from resolveSupabaseCaPem(), not process.env directly, so a
 * CA available only in .env.local is picked up the same way DATABASE_URL
 * already is via resolveDatabaseUrl().
 */
export function buildMigrationClientConfig(connectionString: string): {
  connectionString: string;
  ssl?: { ca: string; rejectUnauthorized: true };
} {
  const ssl = getSslConfig(resolveSupabaseCaPem());
  return { connectionString, ...(ssl ? { ssl } : {}) };
}

/**
 * Minimal duck-typed interface for runCli()'s own connection lifecycle -
 * deliberately not the full `pg.Client` type, so a plain fake object can
 * satisfy it in tests without needing every unrelated Client method/property.
 * A real `pg.Client` (via defaultCreatePgClient) satisfies this structurally.
 */
export interface MigrateClientLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  connect(): Promise<void>;
  end(): Promise<void>;
}

export interface RunCliOptions {
  /** Override point for tests - a real run always uses `pg`'s Client. */
  createPgClient?: (connectionString: string) => MigrateClientLike;
  /** Override point for tests - a real run always reads DATABASE_URL. */
  resolveConnectionString?: () => string;
}

function defaultCreatePgClient(connectionString: string): MigrateClientLike {
  return new Client(buildMigrationClientConfig(connectionString)) as unknown as MigrateClientLike;
}

/**
 * `npm run db:migrate` - the CLI wrapper around applyMigrations(). Every log
 * line is a fixed, generic message (optionally naming just a migration
 * filename, itself always one of this repo's own checked-in `.sql` files,
 * never user input) - no path, host, DATABASE_URL, CA content, raw pg
 * error, SQL text, or stack is ever printed. Returns a boolean rather than
 * throwing so direct-run mode (via runCliSafely() below) can never surface
 * an unhandled rejection.
 */
export async function runCli(options: RunCliOptions = {}): Promise<boolean> {
  const resolveConnectionString = options.resolveConnectionString ?? resolveDatabaseUrl;
  const createPgClient = options.createPgClient ?? defaultCreatePgClient;

  let connectionString: string;
  try {
    connectionString = resolveConnectionString();
  } catch {
    console.error('Migration run aborted: DATABASE_URL is not configured.');
    return false;
  }

  // Client construction and client.connect() are both protected together:
  // a bad connection string, an unreachable host, or a TLS handshake
  // failure can each throw from either step, and either failure must
  // (a) return false, (b) never print the underlying pg error - it can
  // embed the hostname, port, or connection string - and (c) still attempt
  // client.end() if a client object was actually constructed.
  let client: MigrateClientLike | undefined;
  try {
    client = createPgClient(connectionString);
    await client.connect();
  } catch {
    console.error('Migration run aborted: could not connect to Postgres.');
    if (client) {
      try {
        await client.end();
      } catch {
        // Best-effort cleanup only - a cleanup failure must never replace
        // or mask the real (already-reported) outcome above, and must
        // never itself be logged.
      }
    }
    return false;
  }

  try {
    const files = listMigrationFiles();
    if (files.length === 0) {
      console.log('No migration files found in lib/server/migrations/.');
      return true;
    }
    const ran = await applyMigrations(client as unknown as Client);
    const skipped = files.filter((f) => !ran.includes(f));

    for (const file of skipped) console.log(`skip   ${file} (already applied)`);
    for (const file of ran) console.log(`apply  ${file}`);
    console.log(ran.length === 0 ? 'Database already up to date.' : `Applied ${ran.length} migration(s).`);
    return true;
  } catch (error) {
    // applyMigrations() throws only a sanitized Error naming just the
    // migration filename (see its own catch block above) - safe to surface
    // directly, unlike a raw pg connection error.
    console.error(`Migration run aborted: ${(error as Error).message}`);
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      // Best-effort cleanup only - never let a cleanup failure mask the
      // real outcome already returned/logged above, and never log it.
    }
  }
}

/**
 * Thin safety net around runCli() for direct-run mode: runCli() is already
 * designed so every internal failure path returns false rather than
 * throwing, but this guarantees the entry point below can never surface as
 * an unhandled promise rejection even if that invariant is ever violated by
 * a future change. `run` is an injection point for tests only - a real
 * invocation always uses runCli itself.
 */
export async function runCliSafely(
  options: RunCliOptions = {},
  run: (options: RunCliOptions) => Promise<boolean> = runCli,
): Promise<boolean> {
  try {
    return await run(options);
  } catch {
    return false;
  }
}

// Only run the CLI when this file is executed directly (`npm run db:migrate`
// → `tsx lib/server/migrate.ts`), never when imported by a test or another
// module — importing this file must never have the side effect of touching
// a database or calling process.exit.
const isDirectRun =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runCliSafely().then((ok) => {
    process.exitCode = ok ? 0 : 1;
  });
}

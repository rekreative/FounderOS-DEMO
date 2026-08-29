import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  registerInstallation,
  type InstallationPgClient,
} from '../lib/server/installation-registration';
import {
  InstallationMarkerInvalidError,
  InstallationMismatchError,
  InstallationOrphanedPostgresError,
  InstallationSqliteUnavailableError,
} from '../lib/server/installation-errors';
import { resolveDatabaseUrl, resolveSupabaseCaPem } from '../lib/server/migrate';
import { getSslConfig } from '../lib/server/db';

/**
 * `npm run register:installation` - explicit, idempotent CLI for the
 * REKREOS Phase 2 installation marker (see lib/server/installation-registration.ts
 * for the full state machine). Never run automatically on boot or deploy;
 * a human runs this once, by hand, as step 4 of docs/deployment.md's
 * rollout sequence. Requires an explicit --sqlite-path - it never defaults
 * to or guesses data/founder-os.db, and never creates a missing database.
 *
 * Every log line below is a fixed, generic message: no path, UUID,
 * DATABASE_URL, CA content, raw pg error, or stack is ever printed.
 */

export interface PgClientLike extends InstallationPgClient {
  connect(): Promise<void>;
  end(): Promise<void>;
}

export interface RunCliOptions {
  argv?: string[];
  /** Override point for tests - a real run always uses `pg`'s Client. */
  createPgClient?: (connectionString: string) => PgClientLike;
  /** Override point for tests - a real run always reads DATABASE_URL. */
  resolveConnectionString?: () => string;
}

function parseArgs(argv: string[]): { sqlitePath?: string } {
  const out: { sqlitePath?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sqlite-path' && typeof argv[i + 1] === 'string') {
      out.sqlitePath = argv[i + 1];
      i++;
    }
  }
  return out;
}

/**
 * Pure config-building step, kept separate from `new Client(...)` so tests
 * can assert on the exact options passed to `pg.Client` without
 * constructing a real client or dialing any database. Reuses
 * lib/server/db.ts's getSslConfig() exactly - ssl is included only when a
 * CA is available, and rejectUnauthorized is always true, never false - so
 * this CLI's one-off connection gets the same verified-TLS Supabase Session
 * Pooler connection the app's own pg.Pool (and lib/server/migrate.ts's
 * migration runner) already use. The CA itself comes from
 * lib/server/migrate.ts's resolveSupabaseCaPem() (process.env first, then
 * .env.local), not process.env.SUPABASE_CA_PEM directly - this CLI runs
 * standalone via tsx with no Next.js env-loading, so a CA that exists only
 * in .env.local would otherwise be silently dropped, matching how
 * resolveDatabaseUrl() already resolves DATABASE_URL for this same CLI.
 * Never reintroduces sslmode/sslcert/sslkey/sslrootcert into the connection
 * string itself - those would silently override this explicit ssl config
 * (see docs/deployment.md's Supabase TLS section).
 */
export function buildPgClientConfig(connectionString: string): {
  connectionString: string;
  ssl?: { ca: string; rejectUnauthorized: true };
} {
  const ssl = getSslConfig(resolveSupabaseCaPem());
  return { connectionString, ...(ssl ? { ssl } : {}) };
}

function defaultCreatePgClient(connectionString: string): PgClientLike {
  return new Client(buildPgClientConfig(connectionString)) as unknown as PgClientLike;
}

export async function runCli(options: RunCliOptions = {}): Promise<boolean> {
  const argv = options.argv ?? process.argv.slice(2);
  const { sqlitePath } = parseArgs(argv);

  if (!sqlitePath) {
    console.error('Usage: register-installation --sqlite-path <path-to-founder-os.db>');
    console.error('An explicit --sqlite-path is required - this CLI never guesses or defaults to a location, and never creates a missing database.');
    return false;
  }

  const resolveConnectionString = options.resolveConnectionString ?? resolveDatabaseUrl;
  const createPgClient = options.createPgClient ?? defaultCreatePgClient;

  let connectionString: string;
  try {
    connectionString = resolveConnectionString();
  } catch {
    console.error('Installation registration aborted: DATABASE_URL is not configured.');
    return false;
  }

  // Client construction and client.connect() are both protected together:
  // a bad connection string, an unreachable host, or a TLS handshake
  // failure can each throw from either step, and either failure must
  // (a) return false, (b) never print the underlying pg error - it can
  // embed the hostname, port, or connection string - and (c) still attempt
  // client.end() if a client object was actually constructed, since some
  // client implementations open resources (sockets, timers) even before a
  // successful connect().
  let client: PgClientLike | undefined;
  try {
    client = createPgClient(connectionString);
    await client.connect();
  } catch {
    console.error('Installation registration aborted: could not connect to Postgres.');
    if (client) {
      try {
        await client.end();
      } catch {
        // Best-effort cleanup only - a cleanup failure must never replace
        // or mask the real (already-reported) outcome above, and must
        // never itself be logged (it can carry the same kind of
        // connection-detail leak as the original error).
      }
    }
    return false;
  }

  try {
    const result = await registerInstallation({ sqlitePath, pg: client });
    switch (result.outcome) {
      case 'registered':
        console.log('Installation registered.');
        break;
      case 'already_registered':
        console.log('Installation already registered - no changes made.');
        break;
      case 'completed_interrupted':
        console.log('Completed an interrupted registration using the existing SQLite marker.');
        break;
    }
    return true;
  } catch (error) {
    if (
      error instanceof InstallationSqliteUnavailableError ||
      error instanceof InstallationMismatchError ||
      error instanceof InstallationOrphanedPostgresError ||
      error instanceof InstallationMarkerInvalidError
    ) {
      console.error(`Installation registration aborted: ${error.message}`);
    } else {
      console.error('Installation registration failed.');
    }
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

const isDirectRun =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runCliSafely().then((ok) => {
    process.exitCode = ok ? 0 : 1;
  });
}

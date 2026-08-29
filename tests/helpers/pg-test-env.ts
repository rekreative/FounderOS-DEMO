import fs from 'node:fs';
import path from 'node:path';
import { parseEnvFile } from '@/lib/creds';

/**
 * Resolves the connection URL for REAL-Postgres integration tests.
 *
 * SAFETY (do not weaken this without a very good reason): this function
 * NEVER returns process.env.DATABASE_URL, NEVER falls back to .env.local's
 * DATABASE_URL, and NEVER uses lib/creds.ts's readEnvLocal() or any other
 * application/production credential-resolution path as a URL source.
 * DATABASE_URL is this application's own connection string (see
 * .env.example) - in at least one known installation, .env.local's
 * DATABASE_URL is byte-for-byte identical to the Railway production
 * DATABASE_URL. Treating either as an acceptable test-database source would
 * let an integration test run destructive SQL (including migrations that
 * create/drop tables) against production. The ONLY source ever trusted
 * here is the explicit, test-only TEST_DATABASE_URL environment variable,
 * which a human must set deliberately, separately from every application
 * credential.
 *
 * .env.local is read here ONLY for a comparison safety check, never as a
 * value source: if TEST_DATABASE_URL happens to equal DATABASE_URL from
 * EITHER process.env or .env.local, that is a misconfiguration (most
 * likely someone copy-pasted the app's own connection string), and this
 * function throws rather than silently running integration tests against
 * what may be production.
 *
 * Returns undefined (never throws) only when TEST_DATABASE_URL is simply
 * absent, so existing `describe.runIf(Boolean(...))` blocks skip cleanly.
 * Throws a fixed, safe (no URL/host/credential ever included) Error for
 * every other unsafe condition: TEST_DATABASE_URL matching a production
 * source, a non-local host without the explicit remote opt-in, or a
 * malformed URL. A thrown error here is meant to fail the whole test file
 * loudly - a human explicitly set TEST_DATABASE_URL, so an unsafe value is
 * a misconfiguration to fix, not something to skip past silently.
 */

const UNSAFE_MATCHES_APP_DATABASE_URL_ERROR =
  'TEST_DATABASE_URL is not safe to use: it matches this installation\'s application DATABASE_URL (from process.env or .env.local). Refusing to run integration tests against what may be the production database.';

const REMOTE_NOT_ALLOWED_ERROR =
  'TEST_DATABASE_URL points at a non-local host. Set ALLOW_REMOTE_TEST_DATABASE=true to explicitly opt in to a remote test database.';

const MALFORMED_ERROR = 'TEST_DATABASE_URL is not a valid connection URL.';

// Exact hostnames only - deliberately no pattern matching (e.g. no
// "*.local" or private-IP-range logic) that could be tricked by a
// deceptively-named remote host. `new URL(...)` always lower-cases hostname
// (and keeps IPv6 literals bracketed), so this set only needs those exact
// forms.
const LOCAL_TEST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Reads .env.local's DATABASE_URL for the comparison check above ONLY -
 * this value is never returned, logged, or used as a connection target.
 * Deliberately does not use lib/creds.ts's readEnvLocal(): that function is
 * a general-purpose credential resolver used throughout the app, and this
 * file must never be mistaken for (or accidentally repurposed as) one of
 * its call sites. Still honors FOUNDER_OS_ENV_LOCAL so tests can point this
 * at a temporary fake file instead of any real .env.local.
 */
function readAppDatabaseUrlFromEnvLocalForComparisonOnly(): string | undefined {
  try {
    const envLocalPath = process.env.FOUNDER_OS_ENV_LOCAL ?? path.join(process.cwd(), '.env.local');
    const raw = fs.readFileSync(envLocalPath, 'utf8');
    return parseEnvFile(raw).DATABASE_URL || undefined;
  } catch {
    return undefined;
  }
}

export function resolveTestDatabaseUrl(): string | undefined {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) return undefined;

  // Comparison-only protection against both known application-credential
  // sources - process.env.DATABASE_URL and .env.local's DATABASE_URL are
  // read here ONLY to compare against, never as a fallback value.
  const appDatabaseUrl = process.env.DATABASE_URL;
  const envLocalDatabaseUrl = readAppDatabaseUrlFromEnvLocalForComparisonOnly();
  if ((appDatabaseUrl && testUrl === appDatabaseUrl) || (envLocalDatabaseUrl && testUrl === envLocalDatabaseUrl)) {
    throw new Error(UNSAFE_MATCHES_APP_DATABASE_URL_ERROR);
  }

  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch {
    throw new Error(MALFORMED_ERROR);
  }
  if (!parsed.hostname) {
    throw new Error(MALFORMED_ERROR);
  }

  if (!LOCAL_TEST_HOSTS.has(parsed.hostname) && process.env.ALLOW_REMOTE_TEST_DATABASE !== 'true') {
    throw new Error(REMOTE_NOT_ALLOWED_ERROR);
  }

  return testUrl;
}

/**
 * Sets process.env.DATABASE_URL for the current test file - but only after
 * resolveTestDatabaseUrl() has already run every safety check above.
 * DATABASE_URL is assigned here (rather than tests reading TEST_DATABASE_URL
 * directly) because the repos/connection code under test all read
 * DATABASE_URL, exactly as the running application does - this is purely a
 * wiring convenience for that existing code, never a broadening of what
 * counts as a safe source above.
 */
export function installTestDatabaseUrl(): string | undefined {
  const url = resolveTestDatabaseUrl();
  if (url) process.env.DATABASE_URL = url;
  return url;
}

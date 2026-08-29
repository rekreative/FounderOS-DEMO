// Startup gate for FOUNDER_OS_VERIFY_INSTALLATION (REKREOS Phase 2). Plain
// CommonJS - no TypeScript/tsx dependency - because this must run before
// Next's standalone server.js is spawned (see scripts/start-standalone.js),
// and the standalone Railway build only guarantees compiled JS plus
// node_modules, not a TypeScript toolchain. better-sqlite3 and pg are both
// real `dependencies` in package.json, so they are present in that build.
//
// The store name / table name / UUID shape here intentionally mirror
// lib/server/sqlite-installation.ts and lib/server/installation-registration.ts
// (the canonical TypeScript definitions, covered by their own unit tests) -
// duplicated rather than imported, since a plain script run by `node`
// cannot import a .ts module without a TypeScript runtime.
//
// verifyInstallationBeforeStart() NEVER throws: every path resolves to
// { ok, skipped, reason? }, where `reason` is always one of a small set of
// stable, safe categories - never a path, UUID, connection string, CA
// content, or raw error. Every opened handle (SQLite db, Postgres client)
// is closed on every path, success or failure.
const path = require('path');
const Database = require('better-sqlite3');
const { Client } = require('pg');

const VERIFY_FLAG = 'FOUNDER_OS_VERIFY_INSTALLATION';
const REQUIRE_DB_FLAG = 'FOUNDER_OS_REQUIRE_EXISTING_DB';
const STORE_NAME = 'founder-os';
const INSTALLATION_TABLE = 'installation_metadata';
const PG_TABLE = 'sqlite_installations';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Matches lib/server/db.ts's Pool connectionTimeoutMillis: this startup gate
// must never hang indefinitely waiting on an unreachable Postgres host.
const PG_CONNECTION_TIMEOUT_MS = 10_000;

function resolveFounderDbPath(env, cwd) {
  return env.FOUNDER_OS_DB || path.join(cwd, 'data', 'founder-os.db');
}

function readSqliteInstallationId(dbPath) {
  if (dbPath === ':memory:') {
    return { ok: false, reason: 'sqlite_unavailable' };
  }
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('schema_version'); // forces a real page read - surfaces a corrupt file here, not later
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(INSTALLATION_TABLE);
    if (!tableExists) return { ok: false, reason: 'sqlite_marker_missing' };

    const row = db
      .prepare(`SELECT installation_id FROM ${INSTALLATION_TABLE} WHERE store_name = ?`)
      .get(STORE_NAME);
    if (!row) return { ok: false, reason: 'sqlite_marker_missing' };
    if (!UUID_RE.test(row.installation_id)) return { ok: false, reason: 'sqlite_marker_invalid' };
    return { ok: true, installationId: row.installation_id };
  } catch (error) {
    return { ok: false, reason: 'sqlite_unavailable' };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // best-effort close only
      }
    }
  }
}

/**
 * Pure config-building step, kept separate from `new Client(...)` so tests
 * can assert on the exact options without constructing a real client or
 * dialing any database.
 */
function buildPgClientOptions(connectionString, ssl) {
  return Object.assign({ connectionString, connectionTimeoutMillis: PG_CONNECTION_TIMEOUT_MS }, ssl ? { ssl: ssl } : {});
}

function defaultCreatePgClient(connectionString, ssl) {
  return new Client(buildPgClientOptions(connectionString, ssl));
}

async function readPostgresInstallationId(env, createPgClient) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) return { ok: false, reason: 'postgres_unavailable' };

  const ssl = env.SUPABASE_CA_PEM ? { ca: env.SUPABASE_CA_PEM, rejectUnauthorized: true } : undefined;

  // Client construction and client.connect() are both protected together: a
  // bad connection string, an unreachable host, or a TLS handshake failure
  // can each throw from either step. A constructor override (test or
  // otherwise) that throws must still resolve to the same safe
  // 'postgres_unavailable' reason as a connection failure, never propagate
  // as an unhandled exception out of this function.
  let client;
  try {
    client = createPgClient(connectionString, ssl);
    await client.connect();
    const result = await client.query(
      `SELECT installation_id FROM ${PG_TABLE} WHERE store_name = $1`,
      [STORE_NAME],
    );
    if (result.rows.length === 0) return { ok: false, reason: 'postgres_marker_missing' };
    if (result.rows.length > 1) return { ok: false, reason: 'postgres_marker_duplicated' };
    return { ok: true, installationId: result.rows[0].installation_id };
  } catch (error) {
    return { ok: false, reason: 'postgres_unavailable' };
  } finally {
    // Only attempt cleanup if a client object actually got constructed -
    // and a cleanup failure must never crash this function or replace the
    // reason already being returned above.
    if (client) {
      try {
        await client.end();
      } catch {
        // best-effort close only
      }
    }
  }
}

/**
 * Returns { ok: true, skipped: true } when FOUNDER_OS_VERIFY_INSTALLATION is
 * not exactly 'true' - local/dev/test/CI behavior is completely unchanged.
 * Otherwise verifies both markers exist, are well-formed, and match, never
 * creating, seeding, modifying, or repairing anything along the way.
 *
 * `options.createPgClient(connectionString, ssl)` is an override point for
 * tests (a fake client object, no real `pg` dependency needed) - a real run
 * always uses `pg`'s own Client via defaultCreatePgClient.
 */
async function verifyInstallationBeforeStart(env, cwd, options) {
  env = env || process.env;
  cwd = cwd || process.cwd();
  const createPgClient = (options && options.createPgClient) || defaultCreatePgClient;

  if (env[VERIFY_FLAG] !== 'true') {
    return { ok: true, skipped: true };
  }

  if (env[REQUIRE_DB_FLAG] !== 'true') {
    return { ok: false, skipped: false, reason: 'require_existing_db_not_set' };
  }

  const dbPath = resolveFounderDbPath(env, cwd);
  const sqliteResult = readSqliteInstallationId(dbPath);
  if (!sqliteResult.ok) {
    return { ok: false, skipped: false, reason: sqliteResult.reason };
  }

  const pgResult = await readPostgresInstallationId(env, createPgClient);
  if (!pgResult.ok) {
    return { ok: false, skipped: false, reason: pgResult.reason };
  }

  if (pgResult.installationId !== sqliteResult.installationId) {
    return { ok: false, skipped: false, reason: 'installation_mismatch' };
  }

  return { ok: true, skipped: false };
}

module.exports = { verifyInstallationBeforeStart, resolveFounderDbPath, buildPgClientOptions, PG_CONNECTION_TIMEOUT_MS };

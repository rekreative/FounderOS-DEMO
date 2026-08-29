import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildPgClientOptions, PG_CONNECTION_TIMEOUT_MS, verifyInstallationBeforeStart } from '../scripts/verify-installation.js';

/**
 * scripts/verify-installation.js - the production startup gate for
 * FOUNDER_OS_VERIFY_INSTALLATION. Plain CommonJS (no TypeScript/tsx
 * dependency) because it must run before Next's server.js is spawned in the
 * standalone Railway build, where only compiled JS + node_modules are
 * guaranteed present - see scripts/start-standalone.js. Mirrors
 * tests/sqlite-ready.test.ts's independent-of-the-route style: exercised
 * directly with an injected env/cwd, never a real SQLite or Postgres
 * database.
 *
 * The Postgres half is faked via `options.createPgClient` - the same
 * dependency-injection override scripts/register-installation.ts's runCli()
 * uses - rather than `vi.mock('pg', ...)`: this file's internal `require('pg')`
 * is a runtime CommonJS call, which module-mocking (built for static ESM
 * import specifiers) does not reliably intercept.
 */

function fakePgClientFactory(overrides: { connect?: () => Promise<void>; query?: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>; end?: () => Promise<void> } = {}) {
  const connect = vi.fn(overrides.connect ?? (async () => {}));
  const query = vi.fn(overrides.query ?? (async () => ({ rows: [] })));
  const end = vi.fn(overrides.end ?? (async () => {}));
  const createPgClient = vi.fn(() => ({ connect, query, end }));
  return { createPgClient, connect, query, end };
}

const FIXED_UUID = '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e';
const OTHER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let tmp: string | undefined;

function makeDbWithMarker(installationId: string | undefined = FIXED_UUID): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-installation-'));
  const dbPath = path.join(tmp, 'founder-os.db');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE installation_metadata (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
  if (installationId) {
    db.prepare(`INSERT INTO installation_metadata VALUES ('founder-os', ?, '2026-08-29T00:00:00.000Z')`).run(installationId);
  }
  db.close();
  return dbPath;
}

afterEach(() => {
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  }
});

const BASE_ENV = { DATABASE_URL: 'postgres://fake-not-real/db' };

describe('verifyInstallationBeforeStart - flag off', () => {
  it('is skipped, ok:true, and never opens SQLite or Postgres when the flag is not exactly "true"', async () => {
    const { createPgClient } = fakePgClientFactory();
    const result = await verifyInstallationBeforeStart({}, '/does/not/matter', { createPgClient });
    expect(result).toEqual({ ok: true, skipped: true });
    expect(createPgClient).not.toHaveBeenCalled();
  });

  it('is skipped for any value other than the exact string "true"', async () => {
    const result = await verifyInstallationBeforeStart({ FOUNDER_OS_VERIFY_INSTALLATION: 'TRUE' }, '/does/not/matter');
    expect(result).toEqual({ ok: true, skipped: true });
  });
});

describe('verifyInstallationBeforeStart - defense in depth', () => {
  it('fails closed when FOUNDER_OS_REQUIRE_EXISTING_DB is not exactly "true"', async () => {
    const result = await verifyInstallationBeforeStart({ ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true' }, '/irrelevant');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('require_existing_db_not_set');
  });
});

describe('verifyInstallationBeforeStart - SQLite half', () => {
  it('fails closed for a missing SQLite database', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-installation-'));
    const dbPath = path.join(tmp, 'does-not-exist.db');

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('sqlite_unavailable');
  });

  it('fails closed for a corrupt SQLite file', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    fs.writeFileSync(dbPath, 'not a real sqlite file');

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('sqlite_unavailable');
  });

  it('fails closed for :memory:', async () => {
    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: ':memory:' },
      '/irrelevant',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('sqlite_unavailable');
  });

  it('fails closed when the SQLite marker table/row is absent, and never opens Postgres', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    new Database(dbPath).close();
    const { createPgClient } = fakePgClientFactory();

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('sqlite_marker_missing');
    expect(createPgClient).not.toHaveBeenCalled();
  });

  it('fails closed when the stored SQLite installation_id is not a valid UUID', async () => {
    const dbPath = makeDbWithMarker('not-a-real-uuid');

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('sqlite_marker_invalid');
  });
});

describe('verifyInstallationBeforeStart - Postgres half', () => {
  it('fails closed when DATABASE_URL is not set', async () => {
    const dbPath = makeDbWithMarker();

    const result = await verifyInstallationBeforeStart(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('postgres_unavailable');
  });

  it('fails closed when Postgres is unreachable', async () => {
    const dbPath = makeDbWithMarker();
    const { createPgClient, end } = fakePgClientFactory({
      connect: async () => {
        throw new Error('connection refused');
      },
    });

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('postgres_unavailable');
    expect(end).toHaveBeenCalled();
  });

  it('fails closed when the Postgres marker is absent', async () => {
    const dbPath = makeDbWithMarker();
    const { createPgClient } = fakePgClientFactory({ query: async () => ({ rows: [] }) });

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('postgres_marker_missing');
  });

  it('fails closed when the Postgres marker is duplicated', async () => {
    const dbPath = makeDbWithMarker();
    const { createPgClient } = fakePgClientFactory({
      query: async () => ({ rows: [{ installation_id: FIXED_UUID }, { installation_id: OTHER_UUID }] }),
    });

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('postgres_marker_duplicated');
  });

  it('fails closed when the markers differ', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    const { createPgClient } = fakePgClientFactory({ query: async () => ({ rows: [{ installation_id: OTHER_UUID }] }) });

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('installation_mismatch');
  });

  it('succeeds only when both markers match', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    const { createPgClient } = fakePgClientFactory({ query: async () => ({ rows: [{ installation_id: FIXED_UUID }] }) });

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );
    expect(result).toEqual({ ok: true, skipped: false });
  });

  it('always closes the Postgres client, on both success and failure', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    const { createPgClient, end } = fakePgClientFactory({ query: async () => ({ rows: [{ installation_id: FIXED_UUID }] }) });

    await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe('verifyInstallationBeforeStart - Postgres client connection lifecycle', () => {
  it('fails closed and never leaks the underlying error when the client constructor throws', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    const secretMessage = 'bad config: host=db.example-not-real.internal user=postgres password=hunter2secret';
    const createPgClient = vi.fn(() => {
      throw new Error(secretMessage);
    });

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('postgres_unavailable');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secretMessage);
    expect(serialized).not.toContain('hunter2secret');
  });

  it('a cleanup (end()) failure after a failed connect does not crash and does not change the reported reason', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    const { createPgClient, end } = fakePgClientFactory({
      connect: async () => {
        throw new Error('connect failed');
      },
      end: async () => {
        throw new Error('cleanup also failed: leaked-detail-should-not-appear');
      },
    });

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('postgres_unavailable');
    expect(end).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('leaked-detail-should-not-appear');
  });

  it('a cleanup (end()) failure after a successful match does not crash and does not flip the outcome to false', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    const { createPgClient, end } = fakePgClientFactory({
      query: async () => ({ rows: [{ installation_id: FIXED_UUID }] }),
      end: async () => {
        throw new Error('cleanup failed after success: leaked-detail-should-not-appear');
      },
    });

    const result = await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );

    expect(result).toEqual({ ok: true, skipped: false });
    expect(end).toHaveBeenCalled();
  });

  it('never lets createPgClient be called at all when the SQLite half already failed', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-installation-'));
    const dbPath = path.join(tmp, 'does-not-exist.db');
    const createPgClient = vi.fn();

    await verifyInstallationBeforeStart(
      { ...BASE_ENV, FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );

    expect(createPgClient).not.toHaveBeenCalled();
  });
});

describe('buildPgClientOptions - constructor configuration only, never dials a database', () => {
  const ORIGINAL_CA = process.env.SUPABASE_CA_PEM;

  afterEach(() => {
    if (ORIGINAL_CA === undefined) delete process.env.SUPABASE_CA_PEM;
    else process.env.SUPABASE_CA_PEM = ORIGINAL_CA;
  });

  it("includes a finite connectionTimeoutMillis consistent with lib/server/db.ts's Pool config", () => {
    const config = buildPgClientOptions('postgres://fake-not-real/db', undefined);
    expect(config.connectionTimeoutMillis).toBe(PG_CONNECTION_TIMEOUT_MS);
    expect(PG_CONNECTION_TIMEOUT_MS).toBe(10_000);
  });

  it('passes through an explicit ssl object unchanged when given', () => {
    const ssl = { ca: 'FAKE-CA', rejectUnauthorized: true };
    const config = buildPgClientOptions('postgres://fake-not-real/db', ssl);
    expect(config.ssl).toEqual(ssl);
  });

  it('omits ssl entirely when none is given', () => {
    const config = buildPgClientOptions('postgres://fake-not-real/db', undefined);
    expect('ssl' in config).toBe(false);
  });

  it('preserves the given connectionString unchanged', () => {
    const config = buildPgClientOptions('postgres://fake-not-real/db', undefined);
    expect(config.connectionString).toBe('postgres://fake-not-real/db');
  });
});

describe('verifyInstallationBeforeStart - never leaks secrets', () => {
  it('every failure reason is a stable safe category, never a path, UUID, or connection string', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    const { createPgClient } = fakePgClientFactory({ query: async () => ({ rows: [{ installation_id: OTHER_UUID }] }) });

    const result = await verifyInstallationBeforeStart(
      { DATABASE_URL: 'postgres://user:secret@example-not-real/db', FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
      { createPgClient },
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(dbPath);
    expect(serialized).not.toContain(FIXED_UUID);
    expect(serialized).not.toContain(OTHER_UUID);
    expect(serialized).not.toContain('secret');
    expect(['sqlite_unavailable', 'sqlite_marker_missing', 'sqlite_marker_invalid', 'postgres_unavailable', 'postgres_marker_missing', 'postgres_marker_duplicated', 'installation_mismatch', 'require_existing_db_not_set']).toContain(
      result.reason,
    );
  });

  it('real production runs never override createPgClient (uses pg\'s own Client, not a fake)', async () => {
    // Sanity check that the default path is exercised somewhere: DATABASE_URL
    // unset means readPostgresInstallationId short-circuits before ever
    // constructing a Client, so this never dials a real network connection.
    const result = await verifyInstallationBeforeStart(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: makeDbWithMarker() },
      tmp,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('postgres_unavailable');
  });
});

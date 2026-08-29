import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildPgClientConfig, runCli, runCliSafely } from '../scripts/register-installation';
import { INSTALLATION_TABLE, readSqliteInstallation } from '@/lib/server/sqlite-installation';

/**
 * scripts/register-installation.ts's CLI wrapper (`npm run
 * register:installation`) around lib/server/installation-registration.ts.
 * Never dials a real Postgres - a fake pg-client-shaped object is injected
 * via createPgClient, the same override-for-testability shape
 * scripts/backup-sqlite.ts's runCli() already uses. Focuses on the CLI-level
 * contract: an explicit --sqlite-path is required, the database is never
 * created, the Postgres client's connection lifecycle (construct, connect,
 * cleanup) is fully protected, and console output never leaks the path, the
 * UUID, DATABASE_URL, or a raw pg error.
 */

let tmp: string | undefined;

function makeDb(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'register-cli-'));
  const dbPath = path.join(tmp, 'founder-os.db');
  new Database(dbPath).close();
  return dbPath;
}

type FakePgOverrides = {
  initialRow?: { installation_id: string } | null;
  connect?: () => Promise<void>;
  end?: () => Promise<void>;
};

function fakePgFactory(overrides: FakePgOverrides = {}) {
  const state: { row: { installation_id: string } | null; ended: boolean; endCalled: boolean; connected: boolean } = {
    row: overrides.initialRow ?? null,
    ended: false,
    endCalled: false,
    connected: false,
  };
  const client = {
    async connect() {
      if (overrides.connect) {
        await overrides.connect();
        state.connected = true;
        return;
      }
      state.connected = true;
    },
    async query(text: string, params: unknown[] = []) {
      if (/^SELECT installation_id FROM sqlite_installations/.test(text)) {
        return { rows: state.row ? [state.row] : [] };
      }
      if (/^INSERT INTO sqlite_installations/.test(text)) {
        if (!state.row) state.row = { installation_id: params[1] as string };
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
    async end() {
      state.endCalled = true;
      if (overrides.end) {
        await overrides.end();
      }
      state.ended = true;
    },
  };
  return { client, state };
}

afterEach(() => {
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  }
  vi.restoreAllMocks();
});

describe('scripts/register-installation.ts runCli', () => {
  it('fails with a usage message and touches nothing when --sqlite-path is not given', async () => {
    const { client, state } = fakePgFactory();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await runCli({ argv: [], createPgClient: () => client, resolveConnectionString: () => 'postgres://fake' });

    expect(ok).toBe(false);
    expect(state.connected).toBe(false);
    errorSpy.mockRestore();
  });

  it('registers a fresh pair when --sqlite-path is given and neither marker exists', async () => {
    const dbPath = makeDb();
    const { client } = fakePgFactory();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const ok = await runCli({ argv: ['--sqlite-path', dbPath], createPgClient: () => client, resolveConnectionString: () => 'postgres://fake' });

    expect(ok).toBe(true);
    expect(readSqliteInstallation(dbPath)).not.toBeNull();
    logSpy.mockRestore();
  });

  it('succeeds as a no-op when both markers already match', async () => {
    const dbPath = makeDb();
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE ${INSTALLATION_TABLE} (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO ${INSTALLATION_TABLE} VALUES ('founder-os', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-08-29T00:00:00.000Z')`).run();
    db.close();
    const { client } = fakePgFactory({ initialRow: { installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const ok = await runCli({ argv: ['--sqlite-path', dbPath], createPgClient: () => client, resolveConnectionString: () => 'postgres://fake' });

    expect(ok).toBe(true);
  });

  it('fails and always closes the Postgres client, even on a mismatch', async () => {
    const dbPath = makeDb();
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE ${INSTALLATION_TABLE} (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO ${INSTALLATION_TABLE} VALUES ('founder-os', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-08-29T00:00:00.000Z')`).run();
    db.close();
    const { client, state } = fakePgFactory({ initialRow: { installation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await runCli({ argv: ['--sqlite-path', dbPath], createPgClient: () => client, resolveConnectionString: () => 'postgres://fake' });

    expect(ok).toBe(false);
    expect(state.ended).toBe(true);
    errorSpy.mockRestore();
  });

  it('never creates a missing database file', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'register-cli-'));
    const dbPath = path.join(tmp, 'does-not-exist.db');
    const { client } = fakePgFactory();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await runCli({ argv: ['--sqlite-path', dbPath], createPgClient: () => client, resolveConnectionString: () => 'postgres://fake' });

    expect(ok).toBe(false);
    expect(fs.existsSync(dbPath)).toBe(false);
    errorSpy.mockRestore();
  });

  it('never prints the sqlite path, an installation UUID, or a connection string on any outcome', async () => {
    const dbPath = makeDb();
    const secretConnectionString = 'postgres://user:pass@example-not-real.internal:5432/db';
    const { client } = fakePgFactory();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runCli({ argv: ['--sqlite-path', dbPath], createPgClient: () => client, resolveConnectionString: () => secretConnectionString });

    const installationId = readSqliteInstallation(dbPath)?.installationId;
    const allOutput = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call.join(' ')).join('\n');
    expect(allOutput).not.toContain(dbPath);
    expect(allOutput).not.toContain(secretConnectionString);
    if (installationId) expect(allOutput).not.toContain(installationId);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('scripts/register-installation.ts runCli - Postgres client connection lifecycle', () => {
  it('returns false, never leaks the underlying error, and never touches SQLite when the client constructor throws', async () => {
    const dbPath = makeDb();
    const secretMessage = 'ENOTFOUND host=db.example-not-real.internal user=postgres password=hunter2secret';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await runCli({
      argv: ['--sqlite-path', dbPath],
      createPgClient: () => {
        throw new Error(secretMessage);
      },
      resolveConnectionString: () => 'postgres://fake',
    });

    expect(ok).toBe(false);
    expect(readSqliteInstallation(dbPath)).toBeNull();
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain(secretMessage);
    expect(logged).not.toContain('hunter2secret');
    errorSpy.mockRestore();
  });

  it('returns false, never leaks the underlying error, and attempts client.end() when connect() rejects', async () => {
    const dbPath = makeDb();
    const secretMessage = 'connection refused to postgres://user:hunter2secret@example-not-real.internal:5432/db';
    const { client, state } = fakePgFactory({
      connect: async () => {
        throw new Error(secretMessage);
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await runCli({
      argv: ['--sqlite-path', dbPath],
      createPgClient: () => client,
      resolveConnectionString: () => 'postgres://fake',
    });

    expect(ok).toBe(false);
    expect(state.endCalled).toBe(true);
    expect(readSqliteInstallation(dbPath)).toBeNull();
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain(secretMessage);
    expect(logged).not.toContain('hunter2secret');
    errorSpy.mockRestore();
  });

  it('a cleanup (end()) failure after a failed connect does not crash and does not flip the outcome to true', async () => {
    const dbPath = makeDb();
    const { client, state } = fakePgFactory({
      connect: async () => {
        throw new Error('connect failed');
      },
      end: async () => {
        throw new Error('cleanup also failed: leaked-detail-should-not-appear');
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await runCli({
      argv: ['--sqlite-path', dbPath],
      createPgClient: () => client,
      resolveConnectionString: () => 'postgres://fake',
    });

    expect(ok).toBe(false);
    expect(state.endCalled).toBe(true);
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain('leaked-detail-should-not-appear');
    errorSpy.mockRestore();
  });

  it('a cleanup (end()) failure after a successful registration does not crash and does not flip the outcome to false', async () => {
    const dbPath = makeDb();
    const { client, state } = fakePgFactory({
      end: async () => {
        throw new Error('cleanup failed after success: leaked-detail-should-not-appear');
      },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await runCli({
      argv: ['--sqlite-path', dbPath],
      createPgClient: () => client,
      resolveConnectionString: () => 'postgres://fake',
    });

    expect(ok).toBe(true);
    expect(state.endCalled).toBe(true);
    expect(readSqliteInstallation(dbPath)).not.toBeNull();
    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain('leaked-detail-should-not-appear');
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('scripts/register-installation.ts - Supabase TLS (constructor config only, never dials a database)', () => {
  const ORIGINAL_CA = process.env.SUPABASE_CA_PEM;
  const ORIGINAL_ENV_LOCAL = process.env.FOUNDER_OS_ENV_LOCAL;
  let tmpEnvDir: string | undefined;

  afterEach(() => {
    if (ORIGINAL_CA === undefined) delete process.env.SUPABASE_CA_PEM;
    else process.env.SUPABASE_CA_PEM = ORIGINAL_CA;
    if (ORIGINAL_ENV_LOCAL === undefined) delete process.env.FOUNDER_OS_ENV_LOCAL;
    else process.env.FOUNDER_OS_ENV_LOCAL = ORIGINAL_ENV_LOCAL;
    if (tmpEnvDir) {
      fs.rmSync(tmpEnvDir, { recursive: true, force: true });
      tmpEnvDir = undefined;
    }
  });

  it('passes ssl.ca and ssl.rejectUnauthorized=true when SUPABASE_CA_PEM is set', () => {
    process.env.SUPABASE_CA_PEM = '-----BEGIN CERTIFICATE-----\nFAKE-NOT-REAL-TEST-CA\n-----END CERTIFICATE-----';
    const config = buildPgClientConfig('postgres://fake-not-real/db');
    expect(config.ssl).toEqual({ ca: process.env.SUPABASE_CA_PEM, rejectUnauthorized: true });
  });

  it('omits ssl entirely when SUPABASE_CA_PEM is absent - local dev behavior unchanged', () => {
    delete process.env.SUPABASE_CA_PEM;
    const config = buildPgClientConfig('postgres://fake-not-real/db');
    expect('ssl' in config).toBe(false);
  });

  it('never produces rejectUnauthorized: false, even for a falsy SUPABASE_CA_PEM value', () => {
    process.env.SUPABASE_CA_PEM = '';
    const config = buildPgClientConfig('postgres://fake-not-real/db');
    expect('ssl' in config).toBe(false);
  });

  it('preserves the given connectionString unchanged', () => {
    process.env.SUPABASE_CA_PEM = 'FAKE-CA';
    const config = buildPgClientConfig('postgres://fake-not-real/db');
    expect(config.connectionString).toBe('postgres://fake-not-real/db');
  });

  it('falls back to a CA found only in .env.local when process.env.SUPABASE_CA_PEM is unset - consistent with how resolveDatabaseUrl() already resolves DATABASE_URL', () => {
    delete process.env.SUPABASE_CA_PEM;
    tmpEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'register-env-local-'));
    const envLocalPath = path.join(tmpEnvDir, '.env.local');
    fs.writeFileSync(envLocalPath, 'SUPABASE_CA_PEM=fake-ca-from-dot-env-local\n');
    process.env.FOUNDER_OS_ENV_LOCAL = envLocalPath;

    const config = buildPgClientConfig('postgres://fake-not-real/db');
    expect(config.ssl).toEqual({ ca: 'fake-ca-from-dot-env-local', rejectUnauthorized: true });
  });
});

describe('scripts/register-installation.ts runCliSafely - direct-run unhandled-rejection guard', () => {
  it('resolves to false instead of rejecting when the wrapped run function throws unexpectedly', async () => {
    const ok = await runCliSafely({}, async () => {
      throw new Error('completely unexpected failure');
    });
    expect(ok).toBe(false);
  });

  it('never prints anything itself - the wrapped failure is silent at this layer (runCli already logs its own safe message)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runCliSafely({}, async () => {
      throw new Error('secret-detail-should-not-appear');
    });
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain('secret-detail-should-not-appear');
    errorSpy.mockRestore();
  });

  it('passes through the real result when the wrapped run function resolves normally', async () => {
    const ok = await runCliSafely({}, async () => true);
    expect(ok).toBe(true);
  });

  it('defaults to the real runCli when no run function is given', async () => {
    const dbPath = makeDb();
    const { client } = fakePgFactory();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const ok = await runCliSafely({ argv: ['--sqlite-path', dbPath], createPgClient: () => client, resolveConnectionString: () => 'postgres://fake' });

    expect(ok).toBe(true);
  });
});

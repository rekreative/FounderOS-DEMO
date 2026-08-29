import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * lib/server/installation-ready.ts - the checks.installation status GET
 * /api/ready reports (REKREOS Phase 2). Exercised independently of the
 * route (see tests/ready-route.test.ts for the wiring), with a mocked
 * @/lib/server/db query() - same mocking approach tests/ready-route.test.ts
 * already uses for its own Postgres check - so no real Postgres is ever
 * touched here.
 */

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/server/db', () => ({ query: queryMock }));

const FIXED_UUID = '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e';
const OTHER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let tmp: string | undefined;

function makeDbWithMarker(installationId: string | undefined = FIXED_UUID): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'installation-ready-'));
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
  queryMock.mockReset();
});

describe('checkInstallationReady', () => {
  it('reports not_required when the flag is unset, without touching SQLite or Postgres', async () => {
    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady({}, '/this/path/does/not/exist');
    expect(result).toBe('not_required');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('reports not_required for any value other than the exact string "true"', async () => {
    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady({ FOUNDER_OS_VERIFY_INSTALLATION: 'TRUE' }, '/irrelevant');
    expect(result).toBe('not_required');
  });

  it('reports error when enabled but FOUNDER_OS_REQUIRE_EXISTING_DB is not exactly "true" (defense in depth)', async () => {
    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady({ FOUNDER_OS_VERIFY_INSTALLATION: 'true' }, '/irrelevant');
    expect(result).toBe('error');
  });

  it('reports ok when both markers match', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    queryMock.mockResolvedValueOnce({ rows: [{ installation_id: FIXED_UUID }] });

    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );
    expect(result).toBe('ok');
  });

  it('reports error when the SQLite marker is missing', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'installation-ready-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    new Database(dbPath).close();

    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );
    expect(result).toBe('error');
  });

  it('reports error when SQLite is missing/corrupt', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'installation-ready-'));
    const dbPath = path.join(tmp, 'does-not-exist.db');

    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );
    expect(result).toBe('error');
  });

  it('reports error when the Postgres marker is missing', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );
    expect(result).toBe('error');
  });

  it('reports error when the markers differ', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    queryMock.mockResolvedValueOnce({ rows: [{ installation_id: OTHER_UUID }] });

    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );
    expect(result).toBe('error');
  });

  it('reports error when Postgres is unavailable, never throwing', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    queryMock.mockRejectedValueOnce(new Error('connection refused'));

    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    let result: string | undefined;
    await expect(
      (async () => {
        result = await checkInstallationReady(
          { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
          tmp,
        );
      })(),
    ).resolves.not.toThrow();
    expect(result).toBe('error');
  });

  it('never leaks the resolved path or either UUID in its return value', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    queryMock.mockResolvedValueOnce({ rows: [{ installation_id: OTHER_UUID }] });

    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(dbPath);
    expect(serialized).not.toContain(FIXED_UUID);
    expect(serialized).not.toContain(OTHER_UUID);
  });
});

describe('checkInstallationReady - safe logging (no leaks to console.error)', () => {
  // Mirrors what Node's real console.error actually renders for each
  // argument type - crucially, NOT JSON.stringify(error), which silently
  // produces "{}" for a bare Error (message/stack are non-enumerable), and
  // would hide exactly the leak these tests exist to catch.
  function allLoggedText(spy: ReturnType<typeof vi.spyOn>): string {
    return spy.mock.calls
      .map((call) =>
        call
          .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return arg.stack || arg.message;
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(' '),
      )
      .join('\n');
  }

  it('never logs the resolved SQLite path, even inside a secret-looking directory segment', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'installation-ready-'));
    const dbPath = path.join(tmp, 'super-secret-segment', 'does-not-exist.db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );

    expect(result).toBe('error');
    const logged = allLoggedText(errorSpy);
    expect(logged).not.toContain(dbPath);
    expect(logged).not.toContain('super-secret-segment');
    errorSpy.mockRestore();
  });

  it('never logs the raw error message, DATABASE_URL, or CA content when the Postgres query itself fails', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    const fakeSecretMessage =
      'connection to postgres://user:supersecretpassword@example-not-real.internal:5432/db failed (CA=-----BEGIN CERTIFICATE-----FAKE-----END CERTIFICATE-----)';
    queryMock.mockRejectedValueOnce(new Error(fakeSecretMessage));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );

    expect(result).toBe('error');
    const logged = allLoggedText(errorSpy);
    expect(logged).not.toContain(fakeSecretMessage);
    expect(logged).not.toContain('supersecretpassword');
    expect(logged).not.toContain('BEGIN CERTIFICATE');
    expect(logged).not.toContain('postgres://');
    errorSpy.mockRestore();
  });

  it('never logs either installation id when a stored SQLite marker is malformed', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'installation-ready-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE installation_metadata (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
    const malformedId = 'not-a-real-uuid-but-looks-secret-ish';
    db.prepare(`INSERT INTO installation_metadata VALUES ('founder-os', ?, '2026-08-29T00:00:00.000Z')`).run(malformedId);
    db.close();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    const result = await checkInstallationReady(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );

    expect(result).toBe('error');
    const logged = allLoggedText(errorSpy);
    expect(logged).not.toContain(malformedId);
    expect(logged).not.toContain(dbPath);
    errorSpy.mockRestore();
  });

  it('logs only a stable safe category string, never a stack trace', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'installation-ready-'));
    const dbPath = path.join(tmp, 'does-not-exist.db');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { checkInstallationReady } = await import('@/lib/server/installation-ready');
    await checkInstallationReady(
      { FOUNDER_OS_VERIFY_INSTALLATION: 'true', FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath },
      tmp,
    );

    const logged = allLoggedText(errorSpy);
    expect(logged).not.toContain('.ts:');
    expect(logged).not.toContain('    at ');
    expect(logged).not.toMatch(/Error:/);
    errorSpy.mockRestore();
  });
});

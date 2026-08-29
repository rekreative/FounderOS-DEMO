import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * scripts/start-standalone.js spawns the Next.js standalone server.js.
 * server.js does `process.env.HOSTNAME || '0.0.0.0'` — container runtimes
 * (Railway included) routinely auto-populate HOSTNAME with the container's
 * own hostname/ID, which silently overrides that safe default and makes the
 * server bind to an interface Railway's healthcheck prober can't reach
 * (Railway Binding V1). This proves start-standalone.js force-overrides
 * HOSTNAME to '0.0.0.0' on the spawned child regardless of whatever ambient
 * HOSTNAME the container sets, while every other env var — PORT included —
 * passes through unchanged.
 *
 * Real black-box integration test rather than a module mock: vi.mock('fs')
 * / vi.mock('child_process') do not reliably intercept a plain CommonJS
 * script's own require() calls when it's loaded via dynamic import(), so
 * this instead runs scripts/start-standalone.js as a genuine child process
 * against a throwaway "standalone/server.js" stub that just dumps its own
 * env to stdout as JSON — the real spawn() call, the real env object, no
 * mocking gaps to worry about.
 */

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'start-standalone.js');

function runStartStandalone(env: Record<string, string>): NodeJS.ProcessEnv {
  const distDir = mkdtempSync(path.join(tmpdir(), 'start-standalone-'));
  const standaloneDir = path.join(distDir, 'standalone');
  mkdirSync(standaloneDir, { recursive: true });
  writeFileSync(path.join(standaloneDir, 'server.js'), 'process.stdout.write(JSON.stringify(process.env));\n');

  try {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      // cwd inside the empty tmp dir so the script's `fs.existsSync('public')`
      // check (relative to cwd) is false and the real repo's public/ folder
      // is never touched by this test.
      cwd: distDir,
      env: { ...process.env, ...env, NEXT_DIST_DIR: distDir },
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`start-standalone.js exited ${result.status}: ${result.stderr}`);
    }
    return JSON.parse(result.stdout);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
}

/** A real founder-os.db with a valid, matching-shape installation marker
 *  row already written - so tests that need to reach the Postgres half of
 *  verifyInstallationBeforeStart() (constructor/connection failures) don't
 *  get short-circuited by the SQLite half failing first. */
function makeValidMarkerDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'start-standalone-db-'));
  const dbPath = path.join(dir, 'founder-os.db');
  const db = new Database(dbPath);
  db.exec(
    `CREATE TABLE installation_metadata (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`,
  );
  db.prepare(`INSERT INTO installation_metadata VALUES ('founder-os', '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e', '2026-08-29T00:00:00.000Z')`).run();
  db.close();
  return dbPath;
}

function runStartStandaloneRaw(env: Record<string, string>) {
  const distDir = mkdtempSync(path.join(tmpdir(), 'start-standalone-'));
  const standaloneDir = path.join(distDir, 'standalone');
  mkdirSync(standaloneDir, { recursive: true });
  writeFileSync(path.join(standaloneDir, 'server.js'), 'process.stdout.write(JSON.stringify(process.env));\n');

  try {
    return spawnSync(process.execPath, [SCRIPT_PATH], {
      cwd: distDir,
      env: { ...process.env, ...env, NEXT_DIST_DIR: distDir },
      encoding: 'utf8',
    });
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
}

describe('scripts/start-standalone.js — Railway binding', () => {
  it('forces HOSTNAME to 0.0.0.0 even when the ambient environment sets a bad container hostname', () => {
    const env = runStartStandalone({ HOSTNAME: 'some-bad-container-id', PORT: '8080' });
    expect(env.HOSTNAME).toBe('0.0.0.0');
  });

  it('forces HOSTNAME to 0.0.0.0 even when no ambient HOSTNAME is set at all', () => {
    const env = runStartStandalone({ PORT: '3000' });
    expect(env.HOSTNAME).toBe('0.0.0.0');
  });

  it('preserves the Railway-injected PORT unchanged', () => {
    const env = runStartStandalone({ PORT: '4173', HOSTNAME: 'whatever-the-container-set' });
    expect(env.PORT).toBe('4173');
  });

  it('preserves every other existing environment variable untouched', () => {
    const env = runStartStandalone({
      DATABASE_URL: 'postgres://example-not-real/db',
      SOME_UNRELATED_VAR: 'keep-me',
    });
    expect(env.DATABASE_URL).toBe('postgres://example-not-real/db');
    expect(env.SOME_UNRELATED_VAR).toBe('keep-me');
  });
});

describe('scripts/start-standalone.js - FOUNDER_OS_VERIFY_INSTALLATION gate (REKREOS Phase 2)', () => {
  it('flag unset (default): spawns server.js exactly as before, ignoring any installation marker state', () => {
    const env = runStartStandalone({ PORT: '3000', FOUNDER_OS_DB: path.join(tmpdir(), 'does-not-exist-founder-os.db') });
    expect(env.PORT).toBe('3000');
  });

  it('flag enabled but FOUNDER_OS_REQUIRE_EXISTING_DB is not exactly "true": exits nonzero and never spawns server.js', () => {
    const result = runStartStandaloneRaw({
      PORT: '3000',
      FOUNDER_OS_VERIFY_INSTALLATION: 'true',
      FOUNDER_OS_REQUIRE_EXISTING_DB: 'false',
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe(''); // the server.js stub never ran, so it never wrote its env dump
  });

  it('flag enabled and defense-in-depth satisfied, but founder-os.db is missing: exits nonzero and never spawns server.js', () => {
    const missingDbPath = path.join(mkdtempSync(path.join(tmpdir(), 'start-standalone-db-')), 'founder-os.db');
    const result = runStartStandaloneRaw({
      PORT: '3000',
      FOUNDER_OS_VERIFY_INSTALLATION: 'true',
      FOUNDER_OS_REQUIRE_EXISTING_DB: 'true',
      FOUNDER_OS_DB: missingDbPath,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });

  it('a failed verification never prints the SQLite path, DATABASE_URL, or a stack trace to stderr', () => {
    const missingDbPath = path.join(mkdtempSync(path.join(tmpdir(), 'start-standalone-db-')), 'super-secret-segment', 'founder-os.db');
    const result = runStartStandaloneRaw({
      PORT: '3000',
      FOUNDER_OS_VERIFY_INSTALLATION: 'true',
      FOUNDER_OS_REQUIRE_EXISTING_DB: 'true',
      FOUNDER_OS_DB: missingDbPath,
      DATABASE_URL: 'postgres://user:secret-password@example-not-real.internal:5432/db',
    });
    expect(result.stderr).not.toContain(missingDbPath);
    expect(result.stderr).not.toContain('super-secret-segment');
    expect(result.stderr).not.toContain('secret-password');
    expect(result.stderr).not.toContain('postgres://');
  });
});

describe('scripts/start-standalone.js - Postgres client connection lifecycle (real pg.Client, no injection)', () => {
  // These exercise the REAL Postgres client path inside scripts/verify-installation.js
  // (start-standalone.js never passes a createPgClient override), so the
  // SQLite half must pass first - each test writes a real, valid marker
  // database before touching the Postgres half. Cleanup-failure (client.end()
  // throwing) is deliberately NOT re-tested here: it cannot be triggered
  // deterministically against a real pg.Client from a black-box child
  // process, and is already covered at the unit level in
  // tests/verify-installation.test.ts against the exact same
  // verify-installation.js module this script requires unchanged.

  it('a DATABASE_URL that makes the pg.Client constructor throw synchronously still exits nonzero, never spawns server.js, and never leaks the connection string', () => {
    const dbPath = makeValidMarkerDb();
    const result = runStartStandaloneRaw({
      PORT: '3000',
      FOUNDER_OS_VERIFY_INSTALLATION: 'true',
      FOUNDER_OS_REQUIRE_EXISTING_DB: 'true',
      FOUNDER_OS_DB: dbPath,
      // pg's URL parser throws synchronously on this shape (verified
      // directly against pg.Client) - a real constructor-failure trigger,
      // not a simulated one.
      DATABASE_URL: 'postgres://user:pass@',
    });

    // The constructor throw is caught inside verifyInstallationBeforeStart
    // itself and surfaces as the same safe 'postgres_unavailable' reason as
    // a connection failure - it never reaches start-standalone.js's own
    // outer catch (which handles genuinely unexpected failures instead;
    // see the describe block below for that).
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Installation verification failed: postgres_unavailable');
    expect(result.stderr).not.toContain('postgres://user:pass@');
    expect(result.stderr).not.toContain('Invalid URL');
    expect(result.stderr).not.toContain(dbPath);
  }, 15000);

  it('a refused Postgres connection still exits nonzero, never spawns server.js, and never leaks the host or credentials', () => {
    const dbPath = makeValidMarkerDb();
    const result = runStartStandaloneRaw({
      PORT: '3000',
      FOUNDER_OS_VERIFY_INSTALLATION: 'true',
      FOUNDER_OS_REQUIRE_EXISTING_DB: 'true',
      FOUNDER_OS_DB: dbPath,
      // Port 1 refuses immediately on essentially every environment
      // (verified directly: ECONNREFUSED in ~4ms) - a fast, deterministic
      // real connection failure, not a 10s timeout wait.
      DATABASE_URL: 'postgres://someuser:somesecretpassword@127.0.0.1:1/db',
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Installation verification failed: postgres_unavailable');
    expect(result.stderr).not.toContain('somesecretpassword');
    expect(result.stderr).not.toContain('127.0.0.1');
    expect(result.stderr).not.toContain('ECONNREFUSED');
  }, 15000);
});

describe('scripts/start-standalone.js - unexpected startup failure (outside the installation gate)', () => {
  it('a genuinely unexpected failure (a blocked static-file copy) prints only the fixed safe message, never the underlying error, a path, or a stack', () => {
    const distDir = mkdtempSync(path.join(tmpdir(), 'start-standalone-'));
    const standaloneDir = path.join(distDir, 'standalone');
    mkdirSync(standaloneDir, { recursive: true });
    writeFileSync(path.join(standaloneDir, 'server.js'), 'process.stdout.write(JSON.stringify(process.env));\n');

    const cwdDir = mkdtempSync(path.join(tmpdir(), 'start-standalone-cwd-'));
    mkdirSync(path.join(cwdDir, 'public'));
    writeFileSync(path.join(cwdDir, 'public', 'index.html'), 'hi');
    // Pre-create the copy DESTINATION as a plain file so fs.cpSync's
    // recursive directory copy collides with it and throws synchronously -
    // a real, unexpected failure unrelated to the installation gate.
    writeFileSync(path.join(standaloneDir, 'public'), 'blocking file, not a directory');

    try {
      const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        cwd: cwdDir,
        env: { ...process.env, NEXT_DIST_DIR: distDir, PORT: '3000' },
        encoding: 'utf8',
      });

      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('start-standalone.js failed to start.');
      expect(result.stderr).not.toContain(cwdDir);
      expect(result.stderr).not.toContain(distDir);
      expect(result.stderr).not.toContain(standaloneDir);
      expect(result.stderr).not.toContain('    at ');
    } finally {
      rmSync(distDir, { recursive: true, force: true });
      rmSync(cwdDir, { recursive: true, force: true });
    }
  });

  it('preserves the existing missing-server-file message unchanged', () => {
    const distDir = mkdtempSync(path.join(tmpdir(), 'start-standalone-'));
    try {
      const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        cwd: distDir,
        env: { ...process.env, NEXT_DIST_DIR: distDir, PORT: '3000' },
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Standalone server not found at');
      expect(result.stderr).toContain('Run "npm run build" first.');
      expect(existsSync(path.join(distDir, 'standalone', 'server.js'))).toBe(false);
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  });
});

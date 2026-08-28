import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { checkFounderDbReady, isFounderDbRequired, resolveFounderDbPath } from '@/lib/server/sqlite-ready';

/**
 * lib/server/sqlite-ready.ts — the readiness probe GET /api/ready uses.
 * Deliberately exercised in isolation from the route (see
 * tests/ready-route.test.ts for the route-level wiring), with its own temp
 * dirs and an injected env/cwd rather than mutating process.env, so it can
 * never interfere with other test files' FOUNDER_OS_DB/FOUNDER_OS_REQUIRE_EXISTING_DB
 * state. Every opened handle this file creates is closed (directly, or by
 * checkFounderDbReady itself) before its temp dir is removed.
 */

let tmp: string | undefined;

afterEach(() => {
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  }
});

describe('isFounderDbRequired', () => {
  it('true only for the exact string "true"', () => {
    expect(isFounderDbRequired({ FOUNDER_OS_REQUIRE_EXISTING_DB: 'true' })).toBe(true);
    expect(isFounderDbRequired({ FOUNDER_OS_REQUIRE_EXISTING_DB: 'TRUE' })).toBe(false);
    expect(isFounderDbRequired({ FOUNDER_OS_REQUIRE_EXISTING_DB: '1' })).toBe(false);
    expect(isFounderDbRequired({})).toBe(false);
  });
});

describe('resolveFounderDbPath', () => {
  it('matches lib/data.ts\'s own default resolution', () => {
    expect(resolveFounderDbPath({}, '/repo')).toBe(path.join('/repo', 'data', 'founder-os.db'));
    expect(resolveFounderDbPath({ FOUNDER_OS_DB: '/custom/path.db' }, '/repo')).toBe('/custom/path.db');
  });
});

describe('checkFounderDbReady', () => {
  it('reports not_required when the flag is unset, without touching the filesystem', () => {
    const result = checkFounderDbReady({}, '/this/path/does/not/exist');
    expect(result).toEqual({ required: false, status: 'not_required' });
  });

  it('reports not_required when the flag is set to something other than "true"', () => {
    const result = checkFounderDbReady({ FOUNDER_OS_REQUIRE_EXISTING_DB: 'yes' }, '/this/path/does/not/exist');
    expect(result).toEqual({ required: false, status: 'not_required' });
  });

  it('reports ok for an existing, openable database', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-ready-ok-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    new Database(dbPath).close();

    const result = checkFounderDbReady({ FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: dbPath }, tmp);
    expect(result).toEqual({ required: true, status: 'ok' });
  });

  it('reports error for a missing database, never a thrown exception', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-ready-missing-'));
    const missingPath = path.join(tmp, 'founder-os.db');

    let result: ReturnType<typeof checkFounderDbReady> | undefined;
    expect(() => {
      result = checkFounderDbReady({ FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: missingPath }, tmp);
    }).not.toThrow();
    expect(result).toEqual({ required: true, status: 'error' });
  });

  it('the result never carries the resolved path or any error detail', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-ready-leak-check-'));
    const missingPath = path.join(tmp, 'secret-segment', 'founder-os.db');

    const result = checkFounderDbReady({ FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: missingPath }, tmp);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret-segment');
    expect(serialized).not.toContain(missingPath);
  });

  it('reports error for a corrupt (non-SQLite) file rather than throwing', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-ready-corrupt-'));
    const corruptPath = path.join(tmp, 'founder-os.db');
    fs.writeFileSync(corruptPath, 'not a real sqlite file');

    const result = checkFounderDbReady({ FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: corruptPath }, tmp);
    expect(result).toEqual({ required: true, status: 'error' });
  });

  it('treats a required :memory: path as always ok (never a false alarm)', () => {
    const result = checkFounderDbReady({ FOUNDER_OS_REQUIRE_EXISTING_DB: 'true', FOUNDER_OS_DB: ':memory:' }, '/irrelevant');
    expect(result).toEqual({ required: true, status: 'ok' });
  });
});

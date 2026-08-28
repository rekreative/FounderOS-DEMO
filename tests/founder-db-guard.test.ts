import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * lib/data.ts's getDb() singleton, focused on the FOUNDER_OS_REQUIRE_EXISTING_DB
 * production recreation guard (Observability Phase 1). Each test uses a
 * fresh temp dir + FOUNDER_OS_DB override + vi.resetModules(), since
 * getDb()'s `instance` singleton and its dbPath resolution are both fixed
 * at first call. Any handle a test opens is closed before its temp dir is
 * removed - same Windows-lock-avoidance discipline as tests/backup.test.ts
 * and tests/ledger.test.ts.
 */

const ORIGINAL_FLAG = process.env.FOUNDER_OS_REQUIRE_EXISTING_DB;
const ORIGINAL_DB = process.env.FOUNDER_OS_DB;
let tmp: string | undefined;

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.FOUNDER_OS_REQUIRE_EXISTING_DB;
  else process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = ORIGINAL_FLAG;
  if (ORIGINAL_DB === undefined) delete process.env.FOUNDER_OS_DB;
  else process.env.FOUNDER_OS_DB = ORIGINAL_DB;
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  }
  vi.resetModules();
});

describe('getDb() — FOUNDER_OS_REQUIRE_EXISTING_DB guard', () => {
  it('flag absent: auto-creates and seeds a missing database (unchanged behavior)', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'founder-db-guard-'));
    const dbPath = path.join(tmp, 'nested', 'founder-os.db');
    delete process.env.FOUNDER_OS_REQUIRE_EXISTING_DB;
    process.env.FOUNDER_OS_DB = dbPath;

    vi.resetModules();
    const { getDb } = await import('@/lib/data');
    const db = getDb();
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(db.departments.all().length).toBeGreaterThan(0); // seeded
    db.close();
  });

  it('flag false: auto-creates and seeds a missing database (unchanged behavior)', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'founder-db-guard-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = 'false';
    process.env.FOUNDER_OS_DB = dbPath;

    vi.resetModules();
    const { getDb } = await import('@/lib/data');
    const db = getDb();
    expect(fs.existsSync(dbPath)).toBe(true);
    db.close();
  });

  it('flag true + missing database: throws FounderDbMissingError, never creates the file', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'founder-db-guard-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = 'true';
    process.env.FOUNDER_OS_DB = dbPath;

    vi.resetModules();
    const { getDb, FounderDbMissingError } = await import('@/lib/data');
    expect(() => getDb()).toThrow(FounderDbMissingError);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('flag true + missing database: the thrown error never mentions the configured path', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'founder-db-guard-'));
    const dbPath = path.join(tmp, 'super-secret-segment', 'founder-os.db');
    process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = 'true';
    process.env.FOUNDER_OS_DB = dbPath;

    vi.resetModules();
    const { getDb } = await import('@/lib/data');
    let caught: unknown;
    try {
      getDb();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).not.toContain('super-secret-segment');
    expect(message).not.toContain(dbPath);
  });

  it('flag true + existing database: opens normally, never throws', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'founder-db-guard-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    // Pre-create a real founder-os.db, as if a prior boot had already
    // created (and possibly seeded) it.
    new Database(dbPath).close();

    process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = 'true';
    process.env.FOUNDER_OS_DB = dbPath;

    vi.resetModules();
    const { getDb } = await import('@/lib/data');
    let db: ReturnType<typeof getDb> | undefined;
    expect(() => {
      db = getDb();
    }).not.toThrow();
    db?.close();
  });

  it(':memory: remains usable regardless of the flag', async () => {
    process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = 'true';
    process.env.FOUNDER_OS_DB = ':memory:';

    vi.resetModules();
    const { getDb } = await import('@/lib/data');
    let db: ReturnType<typeof getDb> | undefined;
    expect(() => {
      db = getDb();
    }).not.toThrow();
    expect(db?.departments.all().length).toBeGreaterThan(0); // seeded, same as any fresh :memory: db
    db?.close();
  });
});

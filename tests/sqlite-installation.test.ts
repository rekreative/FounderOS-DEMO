import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  INSTALLATION_STORE_NAME,
  INSTALLATION_TABLE,
  isValidInstallationId,
  readSqliteInstallation,
  writeSqliteInstallationIfAbsent,
} from '@/lib/server/sqlite-installation';
import { InstallationMarkerInvalidError, InstallationSqliteUnavailableError } from '@/lib/server/installation-errors';

/**
 * lib/server/sqlite-installation.ts - the SQLite half of the REKREOS Phase 2
 * installation marker. Deliberately exercised in isolation, independent of
 * lib/data.ts's getDb() singleton and the Postgres side (see
 * tests/installation-registration.test.ts for the full state machine).
 * Every handle opened by the module under test is closed internally; each
 * test still cleans up its own temp dir.
 */

let tmp: string | undefined;

afterEach(() => {
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  }
});

describe('isValidInstallationId', () => {
  it('accepts a well-formed v4 UUID', () => {
    expect(isValidInstallationId('4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e')).toBe(true);
  });

  it('rejects non-UUID strings, empty strings, and non-strings', () => {
    expect(isValidInstallationId('not-a-uuid')).toBe(false);
    expect(isValidInstallationId('')).toBe(false);
    expect(isValidInstallationId(12345)).toBe(false);
    expect(isValidInstallationId(null)).toBe(false);
    expect(isValidInstallationId(undefined)).toBe(false);
  });
});

describe('readSqliteInstallation', () => {
  it('returns null when the database exists but has no installation_metadata table yet', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    new Database(dbPath).close();

    expect(readSqliteInstallation(dbPath)).toBeNull();
  });

  it('returns null when the table exists but has no row for the founder-os store', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE ${INSTALLATION_TABLE} (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
    db.close();

    expect(readSqliteInstallation(dbPath)).toBeNull();
  });

  it('returns the stored installation id and timestamp when a row exists', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE ${INSTALLATION_TABLE} (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO ${INSTALLATION_TABLE} (store_name, installation_id, registered_at) VALUES (?, ?, ?)`).run(
      INSTALLATION_STORE_NAME,
      '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e',
      '2026-08-29T00:00:00.000Z',
    );
    db.close();

    expect(readSqliteInstallation(dbPath)).toEqual({
      installationId: '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e',
      registeredAt: '2026-08-29T00:00:00.000Z',
    });
  });

  it('throws InstallationMarkerInvalidError when the stored installation_id is not a valid UUID', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE ${INSTALLATION_TABLE} (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO ${INSTALLATION_TABLE} (store_name, installation_id, registered_at) VALUES (?, ?, ?)`).run(
      INSTALLATION_STORE_NAME,
      'not-a-real-uuid',
      '2026-08-29T00:00:00.000Z',
    );
    db.close();

    expect(() => readSqliteInstallation(dbPath)).toThrow(InstallationMarkerInvalidError);
  });

  it('throws InstallationSqliteUnavailableError for a missing database, never creating it', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'does-not-exist.db');

    expect(() => readSqliteInstallation(dbPath)).toThrow(InstallationSqliteUnavailableError);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('throws InstallationSqliteUnavailableError for a corrupt (non-SQLite) file', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    fs.writeFileSync(dbPath, 'not a real sqlite file');

    expect(() => readSqliteInstallation(dbPath)).toThrow(InstallationSqliteUnavailableError);
  });

  it('throws InstallationSqliteUnavailableError for :memory:', () => {
    expect(() => readSqliteInstallation(':memory:')).toThrow(InstallationSqliteUnavailableError);
  });

  it('never writes anything - a read-only probe', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    new Database(dbPath).close();
    const before = fs.statSync(dbPath).mtimeMs;

    readSqliteInstallation(dbPath);

    expect(fs.statSync(dbPath).mtimeMs).toBe(before);
  });
});

describe('writeSqliteInstallationIfAbsent', () => {
  it('creates the metadata table and writes the row when absent', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    new Database(dbPath).close();

    const result = writeSqliteInstallationIfAbsent(dbPath, '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e', '2026-08-29T00:00:00.000Z');
    expect(result).toEqual({ installationId: '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e', registeredAt: '2026-08-29T00:00:00.000Z' });
    expect(readSqliteInstallation(dbPath)).toEqual(result);
  });

  it('never overwrites an existing row - returns the existing identity unchanged', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    new Database(dbPath).close();
    writeSqliteInstallationIfAbsent(dbPath, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-08-29T00:00:00.000Z');

    const second = writeSqliteInstallationIfAbsent(dbPath, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-08-30T00:00:00.000Z');

    expect(second.installationId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(readSqliteInstallation(dbPath)?.installationId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('never creates a missing database file', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'does-not-exist.db');

    expect(() => writeSqliteInstallationIfAbsent(dbPath, '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e', '2026-08-29T00:00:00.000Z')).toThrow(
      InstallationSqliteUnavailableError,
    );
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('throws InstallationSqliteUnavailableError for :memory:', () => {
    expect(() => writeSqliteInstallationIfAbsent(':memory:', '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e', '2026-08-29T00:00:00.000Z')).toThrow(
      InstallationSqliteUnavailableError,
    );
  });

  it('defensively rejects an invalid installation id and creates nothing at all', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    new Database(dbPath).close();

    expect(() => writeSqliteInstallationIfAbsent(dbPath, 'not-a-real-uuid', '2026-08-29T00:00:00.000Z')).toThrow(
      InstallationMarkerInvalidError,
    );

    // Not just "no row" - the table itself must never have been created,
    // proving validation runs before any file mutation at all.
    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((r: unknown) => (r as { name: string }).name);
    db.close();
    expect(tables).toEqual([]);
  });

  it('rejects an empty string, a non-UUID string, and non-string values the same way', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    new Database(dbPath).close();

    for (const bad of ['', 'still-not-a-uuid', '12345']) {
      expect(() => writeSqliteInstallationIfAbsent(dbPath, bad, '2026-08-29T00:00:00.000Z')).toThrow(
        InstallationMarkerInvalidError,
      );
    }
  });

  it('does not put the identity into any seeded business table', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    new Database(dbPath).close();

    writeSqliteInstallationIfAbsent(dbPath, '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e', '2026-08-29T00:00:00.000Z');

    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((r: unknown) => (r as { name: string }).name);
    db.close();
    expect(tables).toEqual([INSTALLATION_TABLE]);
  });
});

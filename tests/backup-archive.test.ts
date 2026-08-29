import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  parseSuccessfulBackupRunId,
  validateArchiveManifest,
  verifyArchivedBackup,
} from '@/lib/backup-archive';
import { checksumFile, type BackupManifest } from '@/lib/backup';

const RUN_ID = '2026-08-29T03-00-00.000Z';
let tmp = '';

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

function makeManifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    runId: RUN_ID,
    createdAt: '2026-08-29T03:00:00.000Z',
    ok: true,
    backupDir: '/app/data/backups',
    entries: [
      {
        source: 'founder-os',
        sourcePath: '/app/data/founder-os.db',
        filename: `founder-os-${RUN_ID}.db`,
        timestamp: RUN_ID,
        status: 'ok',
        bytes: 8192,
        sha256: 'a'.repeat(64),
        integrityDetail: ['ok'],
        rowCounts: {},
      },
      {
        source: 'bank',
        sourcePath: '/app/data/bank.db',
        filename: null,
        timestamp: RUN_ID,
        status: 'not_present',
        bytes: null,
        sha256: null,
        integrityDetail: null,
        rowCounts: null,
      },
      {
        source: 'ledger',
        sourcePath: '/app/data/ledger.db',
        filename: null,
        timestamp: RUN_ID,
        status: 'not_present',
        bytes: null,
        sha256: null,
        integrityDetail: null,
        rowCounts: null,
      },
    ],
    ...overrides,
  };
}

describe('parseSuccessfulBackupRunId', () => {
  it('extracts the run id from a successful backup CLI result', () => {
    expect(parseSuccessfulBackupRunId(`SQLite backup run ${RUN_ID}\n  founder-os ok`)).toBe(RUN_ID);
  });

  it('rejects failed, missing, or ambiguous run output', () => {
    expect(() => parseSuccessfulBackupRunId(`SQLite backup run ${RUN_ID}, FAILED VERIFICATION`)).toThrow();
    expect(() => parseSuccessfulBackupRunId('backup finished')).toThrow();
    expect(() => parseSuccessfulBackupRunId(`SQLite backup run ${RUN_ID}\nSQLite backup run ${RUN_ID}`)).toThrow();
  });
});

describe('validateArchiveManifest', () => {
  it('accepts one required snapshot and absent optional stores', () => {
    expect(validateArchiveManifest(`manifest-${RUN_ID}.json`, makeManifest(), RUN_ID)).toEqual([
      { filename: `founder-os-${RUN_ID}.db`, bytes: 8192, sha256: 'a'.repeat(64) },
    ]);
  });

  it('rejects path traversal, failed manifests, and malformed checksums', () => {
    const traversal = makeManifest();
    traversal.entries[0].filename = '../founder-os.db';
    expect(() => validateArchiveManifest(`manifest-${RUN_ID}.json`, traversal, RUN_ID)).toThrow();

    expect(() => validateArchiveManifest(`manifest-${RUN_ID}.json`, makeManifest({ ok: false }), RUN_ID)).toThrow();

    const malformedHash = makeManifest();
    malformedHash.entries[0].sha256 = 'secret-not-a-hash';
    expect(() => validateArchiveManifest(`manifest-${RUN_ID}.json`, malformedHash, RUN_ID)).toThrow();
  });

  it('rejects a manifest or entry from a different run', () => {
    expect(() => validateArchiveManifest('manifest-2026-08-28T03-00-00.000Z.json', makeManifest(), RUN_ID)).toThrow();
    const mismatchedEntry = makeManifest();
    mismatchedEntry.entries[0].timestamp = '2026-08-28T03-00-00.000Z';
    expect(() => validateArchiveManifest(`manifest-${RUN_ID}.json`, mismatchedEntry, RUN_ID)).toThrow();
  });
});

describe('verifyArchivedBackup', () => {
  it('verifies size, checksum and SQLite integrity, then removes read-created sidecars', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-archive-'));
    const filename = `founder-os-${RUN_ID}.db`;
    const file = path.join(tmp, filename);
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY); INSERT INTO sample DEFAULT VALUES;');
    db.close();

    const bytes = fs.statSync(file).size;
    const sha256 = await checksumFile(file);
    await expect(verifyArchivedBackup(tmp, { filename, bytes, sha256 })).resolves.toEqual({ filename, bytes, sha256 });
    expect(fs.existsSync(`${file}-wal`)).toBe(false);
    expect(fs.existsSync(`${file}-shm`)).toBe(false);
  });

  it('fails closed on a checksum mismatch without opening another path', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-archive-'));
    const filename = `founder-os-${RUN_ID}.db`;
    const file = path.join(tmp, filename);
    const db = new Database(file);
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY)');
    db.close();

    await expect(
      verifyArchivedBackup(tmp, { filename, bytes: fs.statSync(file).size, sha256: '0'.repeat(64) }),
    ).rejects.toThrow('checksum');
  });
});

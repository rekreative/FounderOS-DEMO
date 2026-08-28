import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb, type FounderDb } from '@/lib/db';
import { openLedger, type Ledger } from '@/lib/ledger';
import { openBankStore, type BankStore } from '@/lib/bank';
import {
  applyRetention,
  checksumFile,
  CollisionError,
  filesystemSafeTimestamp,
  isOwnedManifestFile,
  isOwnedSnapshotFile,
  manifestFilename,
  openSourcesReadonly,
  PreflightError,
  resolveSourceDatabases,
  runBackup,
  snapshotFilename,
  verifyIntegrity,
  type BackupManifest,
  type SnapshotInspection,
} from '@/lib/backup';
import { runCli } from '../scripts/backup-sqlite';

/**
 * All fixtures live under a fresh mkdtemp'd `<tmp>/data/*.db` layout so
 * resolveSourceDatabases's default cwd-relative resolution applies
 * unmodified. Every opened handle (fixture writers, this file's own
 * assertion-time readers) is closed before its temp dir is rmSync'd, same
 * Windows-lock-avoidance discipline as tests/ledger.test.ts and
 * tests/bank.test.ts.
 */

let tmp: string;

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

function makeTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-backup-'));
}

function seedFounderOs(dbPath: string): void {
  const db: FounderDb = openDb(dbPath);
  db.departments.insert({ id: 'dept-tech', name: 'Tech', slug: 'tech', tagline: '', color: '#fff', order: 1 });
  db.agentRuns.insert({ id: 'run-1', agentId: 'agent-1', startedAt: '2026-08-01T00:00:00.000Z', finishedAt: '2026-08-01T00:00:01.000Z', ok: true, summary: 'ok' });
  db.agentRuns.insert({ id: 'run-2', agentId: 'agent-1', startedAt: '2026-08-02T00:00:00.000Z', finishedAt: '2026-08-02T00:00:01.000Z', ok: false, summary: 'fail' });
  db.agentMessages.insert({ id: 'msg-1', agentId: 'agent-1', role: 'user', content: 'hi', toolCalls: [], createdAt: '2026-08-01T00:00:00.000Z' });
  db.broadcasts.insert({ id: 'bc-1', message: 'hello all', createdAt: '2026-08-01T00:00:00.000Z' });
  db.close();
}

function seedBank(dbPath: string): void {
  const store: BankStore = openBankStore(dbPath);
  store.upsert({ account: '7001', business: 'General', month: '2026-06', creditsCents: 1000, debitsCents: 400, netCents: 600 });
  store.close();
}

function seedLedger(dbPath: string): void {
  const led: Ledger = openLedger(dbPath);
  led.insertRows([{ date: '2026-06-01', description: 'AWS', amountCents: 5000, direction: 'out', category: 'Infra' }]);
  led.close();
}

/** Builds a full valid fixture set under <tmp>/data/{founder-os,bank,ledger}.db. */
function seedAllFixtures(root: string): { founderOs: string; bank: string; ledger: string } {
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const founderOs = path.join(dataDir, 'founder-os.db');
  const bank = path.join(dataDir, 'bank.db');
  const ledger = path.join(dataDir, 'ledger.db');
  seedFounderOs(founderOs);
  seedBank(bank);
  seedLedger(ledger);
  return { founderOs, bank, ledger };
}

const VALID_RUN_ID = '2026-08-28T00-00-00.000Z';

describe('filesystemSafeTimestamp', () => {
  it('contains no colon characters', () => {
    const ts = filesystemSafeTimestamp(new Date('2026-08-28T14:32:05.123Z'));
    expect(ts).not.toMatch(/:/);
    expect(ts).toBe('2026-08-28T14-32-05.123Z');
  });

  it('preserves chronological order under lexicographic string comparison', () => {
    const earlier = filesystemSafeTimestamp(new Date('2026-08-28T09:00:00.000Z'));
    const later = filesystemSafeTimestamp(new Date('2026-08-28T14:32:05.123Z'));
    expect(earlier < later).toBe(true);
  });
});

describe('resolveSourceDatabases', () => {
  it('defaults to data/<name>.db under the given cwd when no env override is set', () => {
    const specs = resolveSourceDatabases({}, path.join('C:', 'app'));
    expect(specs.map((s) => s.name)).toEqual(['founder-os', 'bank', 'ledger']);
    expect(specs[0].path).toBe(path.join('C:', 'app', 'data', 'founder-os.db'));
  });

  it('marks founder-os required and bank/ledger optional', () => {
    const specs = resolveSourceDatabases({}, path.join('C:', 'app'));
    expect(specs.map((s) => s.required)).toEqual([true, false, false]);
  });

  it('honors FOUNDER_OS_DB/BANK_DB/LEDGER_DB overrides', () => {
    const specs = resolveSourceDatabases(
      { FOUNDER_OS_DB: '/x/f.db', BANK_DB: '/x/b.db', LEDGER_DB: '/x/l.db' },
      '/unused',
    );
    expect(specs.map((s) => s.path)).toEqual(['/x/f.db', '/x/b.db', '/x/l.db']);
  });
});

describe('checksumFile', () => {
  it('produces the same SHA-256 an independent hash of the same bytes would produce', async () => {
    tmp = makeTmpRoot();
    const file = path.join(tmp, 'sample.bin');
    const bytes = Buffer.from('hello world, this is a checksum fixture');
    fs.writeFileSync(file, bytes);
    const expected = createHash('sha256').update(bytes).digest('hex');
    await expect(checksumFile(file)).resolves.toBe(expected);
  });
});

describe('openSourcesReadonly, preflight', () => {
  it('opens all three when every source exists and is a valid SQLite file', () => {
    tmp = makeTmpRoot();
    const { founderOs, bank, ledger } = seedAllFixtures(tmp);
    const opened = openSourcesReadonly(resolveSourceDatabases({}, tmp));
    expect(opened.map((o) => o.path)).toEqual([founderOs, bank, ledger]);
    for (const o of opened) o.db.close();
  });

  it('throws PreflightError naming the missing required source (founder-os), and never creates it', () => {
    tmp = makeTmpRoot();
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    seedBank(path.join(dataDir, 'bank.db'));
    seedLedger(path.join(dataDir, 'ledger.db'));
    // founder-os.db intentionally never created

    const specs = resolveSourceDatabases({}, tmp);
    let caught: unknown;
    try {
      openSourcesReadonly(specs);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PreflightError);
    expect((caught as PreflightError).problems).toEqual([
      { name: 'founder-os', path: path.join(dataDir, 'founder-os.db'), reason: 'file does not exist' },
    ]);
    // The missing source must still not exist: a readonly/fileMustExist
    // open must never silently create a replacement production database.
    expect(fs.existsSync(path.join(dataDir, 'founder-os.db'))).toBe(false);
  });

  it('does not throw when only optional sources are missing, and returns just the sources that exist', () => {
    tmp = makeTmpRoot();
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    seedFounderOs(path.join(dataDir, 'founder-os.db'));
    // bank.db and ledger.db intentionally never created (optional)

    const opened = openSourcesReadonly(resolveSourceDatabases({}, tmp));
    expect(opened.map((o) => o.name)).toEqual(['founder-os']);
    for (const o of opened) o.db.close();
    expect(fs.existsSync(path.join(dataDir, 'bank.db'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'ledger.db'))).toBe(false);
  });

  it('throws PreflightError naming an unreadable/corrupt source, even when it is optional', () => {
    tmp = makeTmpRoot();
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    seedFounderOs(path.join(dataDir, 'founder-os.db'));
    seedBank(path.join(dataDir, 'bank.db'));
    fs.writeFileSync(path.join(dataDir, 'ledger.db'), 'not a sqlite file at all');

    let caught: unknown;
    try {
      openSourcesReadonly(resolveSourceDatabases({}, tmp));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PreflightError);
    expect((caught as PreflightError).problems).toHaveLength(1);
    expect((caught as PreflightError).problems[0].name).toBe('ledger');
  });
});

describe('verifyIntegrity', () => {
  it('reports ok for a freshly-seeded database', () => {
    tmp = makeTmpRoot();
    const file = path.join(tmp, 'good.db');
    seedFounderOs(file);
    const result = verifyIntegrity(file);
    expect(result).toEqual({ ok: true, detail: ['ok'] });
  });
});

describe('runBackup, happy path', () => {
  it('creates a consistent snapshot and manifest for all three databases, all ok, with row counts', async () => {
    tmp = makeTmpRoot();
    seedAllFixtures(tmp);
    const fixedNow = new Date('2026-08-28T14:32:05.123Z');

    const result = await runBackup({ cwd: tmp, now: () => fixedNow });

    expect(result.ok).toBe(true);
    expect(result.manifest.entries).toHaveLength(3);
    expect(result.manifest.runId).toBe('2026-08-28T14-32-05.123Z');
    expect(result.manifest.entries.every((e) => e.status === 'ok')).toBe(true);
    expect(result.manifest.entries.map((e) => e.source)).toEqual(['founder-os', 'bank', 'ledger']);

    const backupDir = path.join(tmp, 'data', 'backups');
    for (const entry of result.manifest.entries) {
      // Already asserted every entry is 'ok' above, so filename is real here.
      const filename = entry.filename as string;
      expect(filename).not.toMatch(/:/);
      expect(filename).toBe(snapshotFilename(entry.source, result.manifest.runId));
      const full = path.join(backupDir, filename);
      expect(fs.existsSync(full)).toBe(true);
      expect(entry.bytes).toBe(fs.statSync(full).size);
      const expectedSha = await checksumFile(full);
      expect(entry.sha256).toBe(expectedSha);
    }

    const founderEntry = result.manifest.entries.find((e) => e.source === 'founder-os')!;
    expect(founderEntry.rowCounts).toEqual({ agent_messages: 1, agent_runs: 2, broadcasts: 1 });

    const bankEntry = result.manifest.entries.find((e) => e.source === 'bank')!;
    const ledgerEntry = result.manifest.entries.find((e) => e.source === 'ledger')!;
    expect(bankEntry.rowCounts).toBeNull();
    expect(ledgerEntry.rowCounts).toBeNull();

    expect(fs.existsSync(result.manifestPath)).toBe(true);
    expect(path.basename(result.manifestPath)).toBe(manifestFilename(result.manifest.runId));
    const onDisk = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as BackupManifest;
    expect(onDisk.ok).toBe(true);

    expect(result.retention.applied).toBe(true);
    expect(result.retention.keptRunIds).toEqual([result.manifest.runId]);
    expect(result.retention.deletedFiles).toEqual([]);
  });

  it('leaves the source databases byte-for-byte untouched (read-only preflight)', async () => {
    tmp = makeTmpRoot();
    const { founderOs } = seedAllFixtures(tmp);
    const before = fs.readFileSync(founderOs);
    await runBackup({ cwd: tmp, now: () => new Date('2026-08-28T00:00:00.000Z') });
    const after = fs.readFileSync(founderOs);
    expect(after.equals(before)).toBe(true);
  });
});

describe('runBackup, preflight abort', () => {
  it('rejects with PreflightError and creates no backups/ directory at all when founder-os is missing', async () => {
    tmp = makeTmpRoot();
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    seedBank(path.join(dataDir, 'bank.db'));
    seedLedger(path.join(dataDir, 'ledger.db'));
    // founder-os.db missing

    await expect(runBackup({ cwd: tmp })).rejects.toBeInstanceOf(PreflightError);
    expect(fs.existsSync(path.join(dataDir, 'backups'))).toBe(false);
  });

  it('rejects with PreflightError when founder-os is missing even though both optional sources are also absent', async () => {
    tmp = makeTmpRoot();
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    // Nothing exists yet at all - the exact fresh/empty-volume shape a
    // freshly deployed production environment has before its first request.

    await expect(runBackup({ cwd: tmp })).rejects.toBeInstanceOf(PreflightError);
    expect(fs.existsSync(path.join(dataDir, 'backups'))).toBe(false);
  });
});

describe('runBackup, optional sources', () => {
  it('succeeds with founder-os ok and both optional sources not_present when only founder-os exists', async () => {
    tmp = makeTmpRoot();
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    seedFounderOs(path.join(dataDir, 'founder-os.db'));
    // bank.db and ledger.db intentionally never created

    const fixedNow = new Date('2026-08-28T00:00:00.000Z');
    const result = await runBackup({ cwd: tmp, now: () => fixedNow });

    expect(result.ok).toBe(true);
    expect(result.manifest.entries).toHaveLength(3);
    expect(result.manifest.entries.map((e) => e.source)).toEqual(['founder-os', 'bank', 'ledger']);

    const founderEntry = result.manifest.entries.find((e) => e.source === 'founder-os')!;
    expect(founderEntry.status).toBe('ok');
    expect(founderEntry.filename).toBe(snapshotFilename('founder-os', filesystemSafeTimestamp(fixedNow)));

    for (const source of ['bank', 'ledger'] as const) {
      const entry = result.manifest.entries.find((e) => e.source === source)!;
      expect(entry.status).toBe('not_present');
      expect(entry.filename).toBeNull();
      expect(entry.bytes).toBeNull();
      expect(entry.sha256).toBeNull();
      expect(entry.integrityDetail).toBeNull();
      expect(entry.rowCounts).toBeNull();
      expect(entry.error).toBeUndefined();
    }

    // No snapshot file was ever created for either absent optional source.
    const backupDir = path.join(dataDir, 'backups');
    const timestamp = filesystemSafeTimestamp(fixedNow);
    expect(fs.existsSync(path.join(backupDir, snapshotFilename('bank', timestamp)))).toBe(false);
    expect(fs.existsSync(path.join(backupDir, snapshotFilename('ledger', timestamp)))).toBe(false);

    // An all-ok/not_present run is still eligible for retention.
    expect(result.retention.applied).toBe(true);
  });

  it('records one optional source ok and the other not_present when only one optional source is present', async () => {
    tmp = makeTmpRoot();
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    seedFounderOs(path.join(dataDir, 'founder-os.db'));
    seedBank(path.join(dataDir, 'bank.db'));
    // ledger.db intentionally never created

    const result = await runBackup({ cwd: tmp, now: () => new Date('2026-08-28T00:00:00.000Z') });

    expect(result.ok).toBe(true);

    const bankEntry = result.manifest.entries.find((e) => e.source === 'bank')!;
    expect(bankEntry.status).toBe('ok');
    expect(bankEntry.filename).not.toBeNull();
    expect(fs.existsSync(path.join(dataDir, 'backups', bankEntry.filename as string))).toBe(true);

    const ledgerEntry = result.manifest.entries.find((e) => e.source === 'ledger')!;
    expect(ledgerEntry.status).toBe('not_present');
    expect(ledgerEntry.filename).toBeNull();
  });
});

describe('runBackup, collision protection ignores absent optional destinations', () => {
  it('does not treat a stray file at an absent optional snapshot path as a collision', async () => {
    tmp = makeTmpRoot();
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    seedFounderOs(path.join(dataDir, 'founder-os.db'));
    // bank.db intentionally never created (optional, absent)

    const fixedNow = new Date('2026-08-28T00:00:00.000Z');
    const backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    // A file already sits exactly where bank's snapshot would land this run,
    // even though bank.db does not exist. Since bank is not_present this
    // run, no snapshot will ever be attempted for it, so this must not be
    // treated as a collision.
    const strayFile = path.join(backupDir, snapshotFilename('bank', filesystemSafeTimestamp(fixedNow)));
    fs.writeFileSync(strayFile, 'unrelated leftover file, not produced by this run');

    const result = await runBackup({ cwd: tmp, now: () => fixedNow });

    expect(result.ok).toBe(true);
    const bankEntry = result.manifest.entries.find((e) => e.source === 'bank')!;
    expect(bankEntry.status).toBe('not_present');
    expect(fs.readFileSync(strayFile, 'utf8')).toBe('unrelated leftover file, not produced by this run');
  });
});

describe('runBackup, keep validation', () => {
  it('rejects a non-integer keep', async () => {
    tmp = makeTmpRoot();
    seedAllFixtures(tmp);
    await expect(runBackup({ cwd: tmp, keep: 1.5 })).rejects.toBeInstanceOf(RangeError);
  });

  it('rejects a keep less than 1', async () => {
    tmp = makeTmpRoot();
    seedAllFixtures(tmp);
    await expect(runBackup({ cwd: tmp, keep: 0 })).rejects.toBeInstanceOf(RangeError);
  });

  it('accepts keep = 1', async () => {
    tmp = makeTmpRoot();
    seedAllFixtures(tmp);
    const result = await runBackup({ cwd: tmp, keep: 1, now: () => new Date('2026-08-28T00:00:00.000Z') });
    expect(result.ok).toBe(true);
  });
});

describe('runBackup, collision protection', () => {
  it('refuses to overwrite an existing snapshot for the same run id and creates no manifest', async () => {
    tmp = makeTmpRoot();
    seedAllFixtures(tmp);
    const fixedNow = new Date('2026-08-28T00:00:00.000Z');
    const backupDir = path.join(tmp, 'data', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const collidingFile = path.join(backupDir, snapshotFilename('founder-os', filesystemSafeTimestamp(fixedNow)));
    const preexistingContent = 'previous run, must never be overwritten';
    fs.writeFileSync(collidingFile, preexistingContent);

    let caught: unknown;
    try {
      await runBackup({ cwd: tmp, now: () => fixedNow });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CollisionError);
    expect((caught as CollisionError).existingFiles).toContain(path.basename(collidingFile));
    // The colliding file's content must be untouched, and no manifest for
    // this run id was ever written.
    expect(fs.readFileSync(collidingFile, 'utf8')).toBe(preexistingContent);
    expect(fs.existsSync(path.join(backupDir, manifestFilename(filesystemSafeTimestamp(fixedNow))))).toBe(false);
  });

  it('refuses to overwrite an existing manifest for the same run id', async () => {
    tmp = makeTmpRoot();
    seedAllFixtures(tmp);
    const fixedNow = new Date('2026-08-28T00:00:00.000Z');
    const backupDir = path.join(tmp, 'data', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, manifestFilename(filesystemSafeTimestamp(fixedNow))), '{"previous":"manifest"}');

    await expect(runBackup({ cwd: tmp, now: () => fixedNow })).rejects.toBeInstanceOf(CollisionError);
    // No snapshot files should have been created for this run id either.
    for (const source of ['founder-os', 'bank', 'ledger'] as const) {
      expect(fs.existsSync(path.join(backupDir, snapshotFilename(source, filesystemSafeTimestamp(fixedNow))))).toBe(false);
    }
  });
});

describe('runBackup, post-snapshot verification failure', () => {
  it('marks the run failed, preserves the snapshot as evidence, and skips retention, when one source fails inspection', async () => {
    tmp = makeTmpRoot();
    seedAllFixtures(tmp);
    const fixedNow = new Date('2026-08-28T00:00:00.000Z');

    // Deterministic injection: fail inspection only for the ledger
    // snapshot, exactly the case verifyIntegrity/checksum/stat/row-count
    // inspection throwing after a snapshot already exists on disk.
    const failingInspect = async (destPath: string): Promise<SnapshotInspection> => {
      if (destPath.includes('ledger-')) {
        throw new Error('simulated post-snapshot inspection failure');
      }
      const { inspectSnapshot } = await import('@/lib/backup');
      return inspectSnapshot(destPath);
    };

    const result = await runBackup({ cwd: tmp, now: () => fixedNow, inspectSnapshot: failingInspect });

    expect(result.ok).toBe(false);
    const ledgerEntry = result.manifest.entries.find((e) => e.source === 'ledger')!;
    expect(ledgerEntry.status).toBe('verification_failed');
    expect(ledgerEntry.error).toMatch(/simulated post-snapshot inspection failure/);
    expect(ledgerEntry.bytes).toBeNull();
    expect(ledgerEntry.sha256).toBeNull();

    const founderEntry = result.manifest.entries.find((e) => e.source === 'founder-os')!;
    const bankEntry = result.manifest.entries.find((e) => e.source === 'bank')!;
    expect(founderEntry.status).toBe('ok');
    expect(bankEntry.status).toBe('ok');

    // The manifest was still written, describing the failure.
    expect(fs.existsSync(result.manifestPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')) as BackupManifest;
    expect(onDisk.ok).toBe(false);

    // The ledger snapshot file itself was created by backupOne before
    // inspection failed, and must be preserved as failed-run evidence.
    const backupDir = path.join(tmp, 'data', 'backups');
    const ledgerSnapshotPath = path.join(backupDir, ledgerEntry.filename as string);
    expect(fs.existsSync(ledgerSnapshotPath)).toBe(true);

    // Retention never runs for a failed set.
    expect(result.retention.applied).toBe(false);
  });
});

describe('scripts/backup-sqlite.ts runCli', () => {
  it('returns true and writes a manifest for a valid fixture set', async () => {
    tmp = makeTmpRoot();
    seedAllFixtures(tmp);
    const ok = await runCli({ cwd: tmp, now: () => new Date('2026-08-28T00:00:00.000Z') });
    expect(ok).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'data', 'backups', 'manifest-2026-08-28T00-00-00.000Z.json'))).toBe(true);
  });

  it('returns false (never throws) when the required founder-os source is missing, and creates no files', async () => {
    tmp = makeTmpRoot();
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    seedBank(path.join(dataDir, 'bank.db'));
    seedLedger(path.join(dataDir, 'ledger.db'));
    // founder-os.db missing

    const ok = await runCli({ cwd: tmp });
    expect(ok).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'backups'))).toBe(false);
  });

  it('returns true and clearly prints not_present for each absent optional source when only founder-os exists', async () => {
    tmp = makeTmpRoot();
    const dataDir = path.join(tmp, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    seedFounderOs(path.join(dataDir, 'founder-os.db'));
    // bank.db and ledger.db both missing (optional)

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const ok = await runCli({ cwd: tmp, now: () => new Date('2026-08-28T00:00:00.000Z') });
      expect(ok).toBe(true);
      const output = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(output).toMatch(/bank\s+not_present/);
      expect(output).toMatch(/ledger\s+not_present/);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('returns false (never throws) when a collision is detected', async () => {
    tmp = makeTmpRoot();
    seedAllFixtures(tmp);
    const fixedNow = new Date('2026-08-28T00:00:00.000Z');
    const backupDir = path.join(tmp, 'data', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, snapshotFilename('bank', filesystemSafeTimestamp(fixedNow))), 'existing');

    const ok = await runCli({ cwd: tmp, now: () => fixedNow });
    expect(ok).toBe(false);
  });
});

describe('applyRetention, keep validation', () => {
  it('rejects a non-integer keep', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    expect(() => applyRetention(backupDir, 2.5)).toThrow(RangeError);
  });

  it('rejects keep less than 1', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    expect(() => applyRetention(backupDir, 0)).toThrow(RangeError);
    expect(() => applyRetention(backupDir, -3)).toThrow(RangeError);
  });
});

describe('applyRetention', () => {
  function writeFakeSet(
    backupDir: string,
    runId: string,
    ok: boolean,
    sources: Array<'founder-os' | 'bank' | 'ledger'> = ['founder-os', 'bank', 'ledger'],
  ): void {
    const entries = sources.map((source) => {
      const filename = snapshotFilename(source, runId);
      fs.writeFileSync(path.join(backupDir, filename), 'fixture-bytes');
      return { source, filename, status: 'ok' };
    });
    const manifest = { runId, createdAt: runId, ok, backupDir, entries };
    fs.writeFileSync(path.join(backupDir, manifestFilename(runId)), JSON.stringify(manifest));
  }

  /** Same shape as writeFakeSet, but each source in `absentOptional` (bank
   *  and/or ledger only - founder-os is always required and 'ok') gets a
   *  clean 'not_present' entry instead: no snapshot file is written for it,
   *  and its entry carries filename/bytes/sha256/integrityDetail/rowCounts
   *  all null, matching exactly what a real runBackup() produces. */
  function writeFakeSetWithOptionalAbsent(
    backupDir: string,
    runId: string,
    absentOptional: Array<'bank' | 'ledger'>,
  ): void {
    const sources: Array<'founder-os' | 'bank' | 'ledger'> = ['founder-os', 'bank', 'ledger'];
    const entries = sources.map((source) => {
      if (source !== 'founder-os' && absentOptional.includes(source)) {
        return {
          source,
          status: 'not_present',
          filename: null,
          bytes: null,
          sha256: null,
          integrityDetail: null,
          rowCounts: null,
        };
      }
      const filename = snapshotFilename(source, runId);
      fs.writeFileSync(path.join(backupDir, filename), 'fixture-bytes');
      return { source, filename, status: 'ok' };
    });
    const manifest = { runId, createdAt: runId, ok: true, backupDir, entries };
    fs.writeFileSync(path.join(backupDir, manifestFilename(runId)), JSON.stringify(manifest));
  }

  it('keeps only the latest N successful sets and deletes older successful sets exact files', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const ids = ['2026-08-01T00-00-00.000Z', '2026-08-02T00-00-00.000Z', '2026-08-03T00-00-00.000Z', '2026-08-04T00-00-00.000Z', '2026-08-05T00-00-00.000Z'];
    for (const id of ids) writeFakeSet(backupDir, id, true);

    const result = applyRetention(backupDir, 3);

    expect(result.applied).toBe(true);
    expect(result.keptRunIds).toEqual(['2026-08-05T00-00-00.000Z', '2026-08-04T00-00-00.000Z', '2026-08-03T00-00-00.000Z']);

    for (const id of ['2026-08-01T00-00-00.000Z', '2026-08-02T00-00-00.000Z']) {
      expect(fs.existsSync(path.join(backupDir, manifestFilename(id)))).toBe(false);
      for (const source of ['founder-os', 'bank', 'ledger'] as const) {
        expect(fs.existsSync(path.join(backupDir, snapshotFilename(source, id)))).toBe(false);
      }
    }
    for (const id of ['2026-08-03T00-00-00.000Z', '2026-08-04T00-00-00.000Z', '2026-08-05T00-00-00.000Z']) {
      expect(fs.existsSync(path.join(backupDir, manifestFilename(id)))).toBe(true);
      for (const source of ['founder-os', 'bank', 'ledger'] as const) {
        expect(fs.existsSync(path.join(backupDir, snapshotFilename(source, id)))).toBe(true);
      }
    }
  });

  it('never deletes a failed set evidence, even when older than every kept successful set', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    writeFakeSet(backupDir, '2026-08-01T00-00-00.000Z', false); // oldest, but failed
    writeFakeSet(backupDir, '2026-08-02T00-00-00.000Z', true);
    writeFakeSet(backupDir, '2026-08-03T00-00-00.000Z', true);
    writeFakeSet(backupDir, '2026-08-04T00-00-00.000Z', true);

    const result = applyRetention(backupDir, 3);

    expect(result.keptRunIds).toEqual(['2026-08-04T00-00-00.000Z', '2026-08-03T00-00-00.000Z', '2026-08-02T00-00-00.000Z']);
    expect(result.deletedFiles).toEqual([]); // only 3 successful sets exist total, nothing to prune
    expect(fs.existsSync(path.join(backupDir, manifestFilename('2026-08-01T00-00-00.000Z')))).toBe(true);
    for (const source of ['founder-os', 'bank', 'ledger'] as const) {
      expect(fs.existsSync(path.join(backupDir, snapshotFilename(source, '2026-08-01T00-00-00.000Z')))).toBe(true);
    }
  });

  it('never touches a source database or an unrelated file sitting inside the backup directory', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    for (const id of ['2026-08-01T00-00-00.000Z', '2026-08-02T00-00-00.000Z', '2026-08-03T00-00-00.000Z', '2026-08-04T00-00-00.000Z']) {
      writeFakeSet(backupDir, id, true);
    }
    // A real source DB and a WAL sidecar accidentally sitting in the backups
    // dir, plus a totally unrelated file: none of these match the owned
    // naming contract and must survive regardless of retention.
    fs.writeFileSync(path.join(backupDir, 'founder-os.db'), 'REAL SOURCE, must never be touched');
    fs.writeFileSync(path.join(backupDir, 'founder-os.db-wal'), 'wal sidecar');
    fs.writeFileSync(path.join(backupDir, 'notes.txt'), 'unrelated');

    applyRetention(backupDir, 3);

    expect(fs.readFileSync(path.join(backupDir, 'founder-os.db'), 'utf8')).toBe('REAL SOURCE, must never be touched');
    expect(fs.existsSync(path.join(backupDir, 'founder-os.db-wal'))).toBe(true);
    expect(fs.existsSync(path.join(backupDir, 'notes.txt'))).toBe(true);
  });

  it('never touches an unrelated file one level outside the backup directory', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    for (const id of ['2026-08-01T00-00-00.000Z', '2026-08-02T00-00-00.000Z', '2026-08-03T00-00-00.000Z', '2026-08-04T00-00-00.000Z']) {
      writeFakeSet(backupDir, id, true);
    }
    const outsideFile = path.join(tmp, 'outside.db');
    fs.writeFileSync(outsideFile, 'must never be touched, lives outside backupDir');

    applyRetention(backupDir, 3);

    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('must never be touched, lives outside backupDir');
  });

  it('ignores a malformed manifest file rather than deleting anything based on it', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, manifestFilename('2026-08-01T00-00-00.000Z')), '{ not valid json');

    const result = applyRetention(backupDir, 3);
    expect(result.applied).toBe(true);
    expect(result.deletedFiles).toEqual([]);
    expect(fs.existsSync(path.join(backupDir, manifestFilename('2026-08-01T00-00-00.000Z')))).toBe(true);
  });

  it('reports applied:false when the backup directory does not exist yet', () => {
    tmp = makeTmpRoot();
    const result = applyRetention(path.join(tmp, 'does-not-exist'), 3);
    expect(result).toEqual({ applied: false, reason: 'backup directory not found', keptRunIds: [], deletedFiles: [] });
  });

  it('accepts a manifest whose optional entries are cleanly not_present, and never invents a file to delete for them', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const ids = [
      '2026-08-01T00-00-00.000Z',
      '2026-08-02T00-00-00.000Z',
      '2026-08-03T00-00-00.000Z',
      '2026-08-04T00-00-00.000Z',
    ];
    for (const id of ids) writeFakeSetWithOptionalAbsent(backupDir, id, ['bank', 'ledger']);

    const result = applyRetention(backupDir, 3);

    expect(result.applied).toBe(true);
    expect(result.keptRunIds).toEqual([ids[3], ids[2], ids[1]]);
    // Only the oldest set's founder-os snapshot and manifest ever existed to
    // delete; bank/ledger were never present for any of these sets, so
    // retention never tries to delete a file for them.
    expect(result.deletedFiles.sort()).toEqual(
      [snapshotFilename('founder-os', ids[0]), manifestFilename(ids[0])].sort(),
    );
    expect(fs.existsSync(path.join(backupDir, snapshotFilename('founder-os', ids[0])))).toBe(false);
  });

  it('accepts a set where one optional source is ok and the other is not_present', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    writeFakeSetWithOptionalAbsent(backupDir, VALID_RUN_ID, ['ledger']);

    const result = applyRetention(backupDir, 1);
    expect(result.keptRunIds).toEqual([VALID_RUN_ID]);
    expect(result.deletedFiles).toEqual([]);
  });
});

describe('applyRetention, malformed not_present entries', () => {
  it('rejects a not_present entry that smuggles a real filename', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, snapshotFilename('founder-os', VALID_RUN_ID)), 'legit');
    fs.writeFileSync(path.join(backupDir, snapshotFilename('ledger', VALID_RUN_ID)), 'legit');
    const sneaky = snapshotFilename('bank', VALID_RUN_ID);
    fs.writeFileSync(path.join(backupDir, sneaky), 'must never be deleted via a fake not_present entry');
    fs.writeFileSync(
      path.join(backupDir, manifestFilename(VALID_RUN_ID)),
      JSON.stringify({
        runId: VALID_RUN_ID,
        ok: true,
        entries: [
          { source: 'founder-os', status: 'ok', filename: snapshotFilename('founder-os', VALID_RUN_ID) },
          { source: 'bank', status: 'not_present', filename: sneaky },
          { source: 'ledger', status: 'ok', filename: snapshotFilename('ledger', VALID_RUN_ID) },
        ],
      }),
    );

    const result = applyRetention(backupDir, 1);
    expect(result.deletedFiles).toEqual([]);
    expect(result.keptRunIds).toEqual([]);
    expect(fs.readFileSync(path.join(backupDir, sneaky), 'utf8')).toBe(
      'must never be deleted via a fake not_present entry',
    );
  });

  it('rejects a not_present entry that carries file metadata even with filename null', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, snapshotFilename('founder-os', VALID_RUN_ID)), 'legit');
    fs.writeFileSync(path.join(backupDir, snapshotFilename('ledger', VALID_RUN_ID)), 'legit');
    fs.writeFileSync(
      path.join(backupDir, manifestFilename(VALID_RUN_ID)),
      JSON.stringify({
        runId: VALID_RUN_ID,
        ok: true,
        entries: [
          { source: 'founder-os', status: 'ok', filename: snapshotFilename('founder-os', VALID_RUN_ID) },
          { source: 'bank', status: 'not_present', filename: null, bytes: 999, sha256: 'not-really-null' },
          { source: 'ledger', status: 'ok', filename: snapshotFilename('ledger', VALID_RUN_ID) },
        ],
      }),
    );

    const result = applyRetention(backupDir, 1);
    expect(result.deletedFiles).toEqual([]);
    expect(result.keptRunIds).toEqual([]);
  });

  it('rejects founder-os declared as not_present, which can never be legitimate', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, snapshotFilename('bank', VALID_RUN_ID)), 'legit');
    fs.writeFileSync(path.join(backupDir, snapshotFilename('ledger', VALID_RUN_ID)), 'legit');
    fs.writeFileSync(
      path.join(backupDir, manifestFilename(VALID_RUN_ID)),
      JSON.stringify({
        runId: VALID_RUN_ID,
        ok: true,
        entries: [
          { source: 'founder-os', status: 'not_present', filename: null },
          { source: 'bank', status: 'ok', filename: snapshotFilename('bank', VALID_RUN_ID) },
          { source: 'ledger', status: 'ok', filename: snapshotFilename('ledger', VALID_RUN_ID) },
        ],
      }),
    );

    const result = applyRetention(backupDir, 1);
    expect(result.deletedFiles).toEqual([]);
    expect(result.keptRunIds).toEqual([]);
  });
});

describe('isOwnedSnapshotFile / isOwnedManifestFile naming contract', () => {
  it('matches only the exact filenames this module produces', () => {
    expect(isOwnedSnapshotFile(snapshotFilename('founder-os', VALID_RUN_ID))).toBe(true);
    expect(isOwnedSnapshotFile(snapshotFilename('bank', VALID_RUN_ID))).toBe(true);
    expect(isOwnedSnapshotFile(snapshotFilename('ledger', VALID_RUN_ID))).toBe(true);
    expect(isOwnedSnapshotFile('founder-os.db')).toBe(false);
    expect(isOwnedSnapshotFile('founder-os.db-wal')).toBe(false);
    expect(isOwnedSnapshotFile('founder-os.db-shm')).toBe(false);
    expect(isOwnedSnapshotFile('random.db')).toBe(false);

    expect(isOwnedManifestFile(manifestFilename(VALID_RUN_ID))).toBe(true);
    expect(isOwnedManifestFile('package.json')).toBe(false);
  });

  it('rejects a forward-slash traversal filename', () => {
    expect(isOwnedSnapshotFile('../founder-os-' + VALID_RUN_ID + '.db')).toBe(false);
    expect(isOwnedSnapshotFile('sub/founder-os-' + VALID_RUN_ID + '.db')).toBe(false);
  });

  it('rejects a backslash traversal filename', () => {
    expect(isOwnedSnapshotFile('..\\founder-os-' + VALID_RUN_ID + '.db')).toBe(false);
    expect(isOwnedSnapshotFile('sub\\founder-os-' + VALID_RUN_ID + '.db')).toBe(false);
  });

  it('rejects a filename with an invalid or incomplete timestamp', () => {
    expect(isOwnedSnapshotFile('founder-os-2026-08-28.db')).toBe(false);
    expect(isOwnedSnapshotFile('founder-os-not-a-timestamp.db')).toBe(false);
    expect(isOwnedSnapshotFile('founder-os-2026-08-28T00-00-00Z.db')).toBe(false); // missing milliseconds
  });
});

describe('applyRetention, adversarial manifest contents', () => {
  function writeValidSnapshotFiles(backupDir: string, runId: string): void {
    for (const source of ['founder-os', 'bank', 'ledger'] as const) {
      fs.writeFileSync(path.join(backupDir, snapshotFilename(source, runId)), 'legit');
    }
  }

  function writeManifest(backupDir: string, manifestName: string, body: unknown): void {
    fs.writeFileSync(path.join(backupDir, manifestName), JSON.stringify(body));
  }

  it('rejects a manifest entry filename using forward-slash traversal, and never deletes the referenced path', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    writeValidSnapshotFiles(backupDir, VALID_RUN_ID);
    writeManifest(backupDir, manifestFilename(VALID_RUN_ID), {
      runId: VALID_RUN_ID,
      ok: true,
      entries: [
        { source: 'founder-os', status: 'ok', filename: '../evil-outside.db' },
        { source: 'bank', status: 'ok', filename: snapshotFilename('bank', VALID_RUN_ID) },
        { source: 'ledger', status: 'ok', filename: snapshotFilename('ledger', VALID_RUN_ID) },
      ],
    });
    const outsideFile = path.join(tmp, 'evil-outside.db');
    fs.writeFileSync(outsideFile, 'must survive');

    const result = applyRetention(backupDir, 1);

    expect(result.deletedFiles).toEqual([]);
    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('must survive');
    // The whole manifest is rejected, so even its legit sibling entries stay untouched.
    for (const source of ['founder-os', 'bank', 'ledger'] as const) {
      expect(fs.existsSync(path.join(backupDir, snapshotFilename(source, VALID_RUN_ID)))).toBe(true);
    }
  });

  it('rejects a manifest entry filename using backslash traversal, and never deletes the referenced path', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    writeValidSnapshotFiles(backupDir, VALID_RUN_ID);
    writeManifest(backupDir, manifestFilename(VALID_RUN_ID), {
      runId: VALID_RUN_ID,
      ok: true,
      entries: [
        { source: 'founder-os', status: 'ok', filename: '..\\evil-outside.db' },
        { source: 'bank', status: 'ok', filename: snapshotFilename('bank', VALID_RUN_ID) },
        { source: 'ledger', status: 'ok', filename: snapshotFilename('ledger', VALID_RUN_ID) },
      ],
    });
    const outsideFile = path.join(tmp, 'evil-outside.db');
    fs.writeFileSync(outsideFile, 'must survive');

    const result = applyRetention(backupDir, 1);

    expect(result.deletedFiles).toEqual([]);
    expect(fs.readFileSync(outsideFile, 'utf8')).toBe('must survive');
  });

  it('rejects a manifest whose entry filename carries an invalid timestamp', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    writeValidSnapshotFiles(backupDir, VALID_RUN_ID);
    writeManifest(backupDir, manifestFilename(VALID_RUN_ID), {
      runId: VALID_RUN_ID,
      ok: true,
      entries: [
        { source: 'founder-os', status: 'ok', filename: 'founder-os-2026-08-28.db' }, // not the exact timestamp shape
        { source: 'bank', status: 'ok', filename: snapshotFilename('bank', VALID_RUN_ID) },
        { source: 'ledger', status: 'ok', filename: snapshotFilename('ledger', VALID_RUN_ID) },
      ],
    });

    const result = applyRetention(backupDir, 1);
    expect(result.deletedFiles).toEqual([]);
  });

  it('rejects a manifest with a duplicate source', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    writeValidSnapshotFiles(backupDir, VALID_RUN_ID);
    writeManifest(backupDir, manifestFilename(VALID_RUN_ID), {
      runId: VALID_RUN_ID,
      ok: true,
      entries: [
        { source: 'founder-os', status: 'ok', filename: snapshotFilename('founder-os', VALID_RUN_ID) },
        { source: 'founder-os', status: 'ok', filename: snapshotFilename('founder-os', VALID_RUN_ID) },
        { source: 'bank', status: 'ok', filename: snapshotFilename('bank', VALID_RUN_ID) },
      ],
    });

    const result = applyRetention(backupDir, 1);
    expect(result.deletedFiles).toEqual([]);
    expect(result.keptRunIds).toEqual([]);
  });

  it('rejects a manifest missing a required source', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    writeValidSnapshotFiles(backupDir, VALID_RUN_ID);
    writeManifest(backupDir, manifestFilename(VALID_RUN_ID), {
      runId: VALID_RUN_ID,
      ok: true,
      entries: [
        { source: 'founder-os', status: 'ok', filename: snapshotFilename('founder-os', VALID_RUN_ID) },
        { source: 'bank', status: 'ok', filename: snapshotFilename('bank', VALID_RUN_ID) },
        // ledger missing entirely
      ],
    });

    const result = applyRetention(backupDir, 1);
    expect(result.deletedFiles).toEqual([]);
    expect(result.keptRunIds).toEqual([]);
  });

  it('rejects a manifest with an unexpected/unknown source', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    writeManifest(backupDir, manifestFilename(VALID_RUN_ID), {
      runId: VALID_RUN_ID,
      ok: true,
      entries: [
        { source: 'founder-os', status: 'ok', filename: snapshotFilename('founder-os', VALID_RUN_ID) },
        { source: 'bank', status: 'ok', filename: snapshotFilename('bank', VALID_RUN_ID) },
        { source: 'not-a-real-source', status: 'ok', filename: 'not-a-real-source-' + VALID_RUN_ID + '.db' },
      ],
    });

    const result = applyRetention(backupDir, 1);
    expect(result.deletedFiles).toEqual([]);
    expect(result.keptRunIds).toEqual([]);
  });

  it('rejects an entry filename built from a different run id than the manifest declares', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const otherRunId = '2026-01-01T00-00-00.000Z';
    writeValidSnapshotFiles(backupDir, VALID_RUN_ID);
    writeManifest(backupDir, manifestFilename(VALID_RUN_ID), {
      runId: VALID_RUN_ID,
      ok: true,
      entries: [
        { source: 'founder-os', status: 'ok', filename: snapshotFilename('founder-os', otherRunId) }, // wrong run id
        { source: 'bank', status: 'ok', filename: snapshotFilename('bank', VALID_RUN_ID) },
        { source: 'ledger', status: 'ok', filename: snapshotFilename('ledger', VALID_RUN_ID) },
      ],
    });

    const result = applyRetention(backupDir, 1);
    expect(result.deletedFiles).toEqual([]);
    expect(result.keptRunIds).toEqual([]);
  });

  it('rejects a manifest whose on-disk filename does not match manifestFilename(runId)', () => {
    tmp = makeTmpRoot();
    const backupDir = path.join(tmp, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    writeValidSnapshotFiles(backupDir, VALID_RUN_ID);
    const otherRunId = '2026-01-01T00-00-00.000Z';
    // Valid-looking manifest filename, but for a different run id than the
    // runId field actually inside it.
    writeManifest(backupDir, manifestFilename(otherRunId), {
      runId: VALID_RUN_ID,
      ok: true,
      entries: [
        { source: 'founder-os', status: 'ok', filename: snapshotFilename('founder-os', VALID_RUN_ID) },
        { source: 'bank', status: 'ok', filename: snapshotFilename('bank', VALID_RUN_ID) },
        { source: 'ledger', status: 'ok', filename: snapshotFilename('ledger', VALID_RUN_ID) },
      ],
    });

    const result = applyRetention(backupDir, 1);
    expect(result.deletedFiles).toEqual([]);
    expect(result.keptRunIds).toEqual([]);
  });
});

describe('runBackup, direct sanity check against a real Database handle', () => {
  it('the destination snapshot opens as an independent, valid SQLite database', async () => {
    tmp = makeTmpRoot();
    seedAllFixtures(tmp);
    const result = await runBackup({ cwd: tmp, now: () => new Date('2026-08-28T00:00:00.000Z') });
    const founderEntry = result.manifest.entries.find((e) => e.source === 'founder-os')!;
    // founder-os is required, so a successful run's entry always has a real filename.
    const destPath = path.join(tmp, 'data', 'backups', founderEntry.filename as string);

    const db = new Database(destPath, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM departments').get() as { n: number };
      expect(row.n).toBe(1);
    } finally {
      db.close();
    }
  });
});

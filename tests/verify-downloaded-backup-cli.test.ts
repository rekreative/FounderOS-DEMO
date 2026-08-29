import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { checksumFile, manifestFilename, snapshotFilename, type BackupManifest } from '@/lib/backup';
import { runCli } from '../scripts/verify-downloaded-backup';

const RUN_ID = '2026-08-29T04-00-00.000Z';
let tmp = '';

afterEach(() => {
  vi.restoreAllMocks();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

async function writeArchive(): Promise<string> {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-archive-cli-'));
  const filename = snapshotFilename('founder-os', RUN_ID);
  const file = path.join(tmp, filename);
  const db = new Database(file);
  db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY); INSERT INTO sample DEFAULT VALUES;');
  db.close();
  const bytes = fs.statSync(file).size;
  const sha256 = await checksumFile(file);
  const manifest: BackupManifest = {
    runId: RUN_ID,
    createdAt: '2026-08-29T04:00:00.000Z',
    ok: true,
    backupDir: '/app/data/backups',
    entries: [
      { source: 'founder-os', sourcePath: '/app/data/founder-os.db', filename, timestamp: RUN_ID, status: 'ok', bytes, sha256, integrityDetail: ['ok'], rowCounts: {} },
      { source: 'bank', sourcePath: '/app/data/bank.db', filename: null, timestamp: RUN_ID, status: 'not_present', bytes: null, sha256: null, integrityDetail: null, rowCounts: null },
      { source: 'ledger', sourcePath: '/app/data/ledger.db', filename: null, timestamp: RUN_ID, status: 'not_present', bytes: null, sha256: null, integrityDetail: null, rowCounts: null },
    ],
  };
  fs.writeFileSync(path.join(tmp, manifestFilename(RUN_ID)), JSON.stringify(manifest));
  return filename;
}

describe('verify-downloaded-backup CLI', () => {
  it('manifest-only mode emits only validated owned filenames', async () => {
    const filename = await writeArchive();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(runCli(['--manifest-only', tmp, RUN_ID])).resolves.toBe(true);
    expect(log).toHaveBeenCalledWith(JSON.stringify([filename]));
  });

  it('fully verifies the downloaded snapshot', async () => {
    await writeArchive();
    await expect(runCli([tmp, RUN_ID])).resolves.toBe(true);
  });

  it('fails with a fixed message and does not leak malformed manifest content', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-archive-cli-'));
    fs.writeFileSync(path.join(tmp, manifestFilename(RUN_ID)), JSON.stringify({ secret: 'sk-fake-secret' }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(runCli(['--manifest-only', tmp, RUN_ID])).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith('Downloaded SQLite backup verification failed.');
    expect(JSON.stringify(error.mock.calls)).not.toContain('sk-fake-secret');
  });
});

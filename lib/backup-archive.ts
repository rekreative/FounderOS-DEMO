import fs from 'node:fs';
import path from 'node:path';
import {
  checksumFile,
  cleanupSnapshotSidecars,
  isOwnedManifestFile,
  isOwnedSnapshotFile,
  manifestFilename,
  snapshotFilename,
  verifyIntegrity,
  type BackupManifest,
  type SourceDbName,
} from './backup';

const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SOURCES: readonly SourceDbName[] = ['founder-os', 'bank', 'ledger'];

export type ArchiveFile = {
  filename: string;
  bytes: number;
  sha256: string;
};

export function parseSuccessfulBackupRunId(output: string): string {
  const matches = [...output.matchAll(/^SQLite backup run (\S+)(.*)$/gm)];
  if (matches.length !== 1 || matches[0][2].includes('FAILED') || !RUN_ID_RE.test(matches[0][1])) {
    throw new Error('Remote SQLite backup did not report one successful run.');
  }
  return matches[0][1];
}

/**
 * Validates an untrusted, downloaded manifest before any filename from it is
 * used. The returned list contains only exact owned filenames for this run.
 */
export function validateArchiveManifest(
  manifestFile: string,
  parsed: unknown,
  expectedRunId: string,
): ArchiveFile[] {
  if (!RUN_ID_RE.test(expectedRunId)) throw new Error('Invalid expected backup run id.');
  if (!isOwnedManifestFile(manifestFile) || manifestFile !== manifestFilename(expectedRunId)) {
    throw new Error('Downloaded backup manifest filename is invalid.');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Downloaded backup manifest is invalid.');

  const manifest = parsed as Partial<BackupManifest>;
  if (manifest.runId !== expectedRunId || manifest.ok !== true || !Array.isArray(manifest.entries)) {
    throw new Error('Downloaded backup manifest is not a successful matching run.');
  }
  if (manifest.entries.length !== SOURCES.length) throw new Error('Downloaded backup manifest source set is invalid.');

  const seen = new Set<string>();
  const files: ArchiveFile[] = [];
  for (const entry of manifest.entries) {
    if (!entry || !SOURCES.includes(entry.source) || seen.has(entry.source)) {
      throw new Error('Downloaded backup manifest source set is invalid.');
    }
    seen.add(entry.source);
    if (entry.timestamp !== expectedRunId) throw new Error('Downloaded backup manifest entry run id is invalid.');

    if (entry.status === 'not_present') {
      if (
        entry.source === 'founder-os' ||
        entry.filename !== null ||
        entry.bytes !== null ||
        entry.sha256 !== null ||
        entry.integrityDetail !== null ||
        entry.rowCounts !== null
      ) {
        throw new Error('Downloaded backup manifest optional entry is invalid.');
      }
      continue;
    }

    const expectedFilename = snapshotFilename(entry.source, expectedRunId);
    const bytes = entry.bytes;
    const sha256 = entry.sha256;
    if (
      entry.status !== 'ok' ||
      entry.filename !== expectedFilename ||
      !isOwnedSnapshotFile(expectedFilename) ||
      typeof bytes !== 'number' ||
      !Number.isSafeInteger(bytes) ||
      bytes < 1 ||
      typeof sha256 !== 'string' ||
      !SHA256_RE.test(sha256) ||
      !Array.isArray(entry.integrityDetail) ||
      entry.integrityDetail.length !== 1 ||
      entry.integrityDetail[0] !== 'ok'
    ) {
      throw new Error('Downloaded backup manifest snapshot entry is invalid.');
    }
    files.push({ filename: expectedFilename, bytes, sha256 });
  }

  if (seen.size !== SOURCES.length || !seen.has('founder-os')) {
    throw new Error('Downloaded backup manifest source set is invalid.');
  }
  return files;
}

export async function verifyArchivedBackup(archiveDir: string, expected: ArchiveFile): Promise<ArchiveFile> {
  if (!isOwnedSnapshotFile(expected.filename)) throw new Error('Archived snapshot filename is invalid.');
  const resolvedDir = path.resolve(archiveDir);
  const filePath = path.resolve(resolvedDir, expected.filename);
  if (path.dirname(filePath) !== resolvedDir) throw new Error('Archived snapshot path is invalid.');

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error('Archived snapshot file is missing.');
  }
  if (!stat.isFile() || stat.size !== expected.bytes) throw new Error('Archived snapshot size does not match manifest.');

  const actualHash = await checksumFile(filePath);
  if (actualHash !== expected.sha256) throw new Error('Archived snapshot checksum does not match manifest.');

  const integrity = verifyIntegrity(filePath);
  if (!integrity.ok) throw new Error('Archived snapshot failed SQLite integrity check.');

  const sidecars = cleanupSnapshotSidecars(resolvedDir, expected.filename);
  if (sidecars.status === 'wal_nonempty') {
    throw new Error('Archived snapshot produced a non-empty WAL during verification.');
  }

  return expected;
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestFilename } from '../lib/backup';
import { validateArchiveManifest, verifyArchivedBackup } from '../lib/backup-archive';

export async function runCli(args: string[] = process.argv.slice(2)): Promise<boolean> {
  const manifestOnly = args[0] === '--manifest-only';
  const offset = manifestOnly ? 1 : 0;
  const archiveDir = args[offset];
  const runId = args[offset + 1];
  if (!archiveDir || !runId || args.length !== offset + 2) {
    console.error('Usage: verify-downloaded-backup [--manifest-only] <archive-directory> <run-id>');
    return false;
  }

  try {
    const manifestFile = manifestFilename(runId);
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(archiveDir, manifestFile), 'utf8'));
    const snapshots = validateArchiveManifest(manifestFile, parsed, runId);

    if (manifestOnly) {
      console.log(JSON.stringify(snapshots.map((entry) => entry.filename)));
      return true;
    }

    for (const snapshot of snapshots) await verifyArchivedBackup(archiveDir, snapshot);
    console.log(`Verified downloaded SQLite backup ${runId}: ${snapshots.length} snapshot(s).`);
    return true;
  } catch {
    console.error('Downloaded SQLite backup verification failed.');
    return false;
  }
}

const isDirectRun =
  process.argv[1] != null && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runCli().then((ok) => {
    process.exitCode = ok ? 0 : 1;
  });
}

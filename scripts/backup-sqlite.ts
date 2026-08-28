import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CollisionError, PreflightError, runBackup, type RunBackupOptions } from '../lib/backup';

/**
 * Manual-only SQLite backup CLI (`npm run backup:sqlite`). Never imported by
 * app/route code and never run automatically on boot or deploy; see
 * lib/server/migrate.ts for the same guarded-direct-run pattern this file
 * copies. `runCli` accepts the same overrides as `runBackup` purely so
 * tests can point it at a fixture directory; the direct-run invocation below
 * always uses real process.cwd()/process.env.
 */
export async function runCli(overrides: RunBackupOptions = {}): Promise<boolean> {
  try {
    const result = await runBackup(overrides);

    console.log(`SQLite backup run ${result.manifest.runId}${result.ok ? '' : ', FAILED VERIFICATION'}`);
    for (const entry of result.manifest.entries) {
      if (entry.status === 'not_present') {
        console.log(`  ${entry.source.padEnd(10)} not_present - optional, not created yet (${entry.sourcePath})`);
        continue;
      }
      const size = entry.bytes != null ? `${(entry.bytes / 1024).toFixed(1)} KiB` : 'n/a';
      console.log(`  ${entry.source.padEnd(10)} ${entry.status.padEnd(19)} ${size.padEnd(10)} sha256=${entry.sha256 ?? 'n/a'}`);
      if (entry.rowCounts) console.log(`             rowCounts: ${JSON.stringify(entry.rowCounts)}`);
      if (entry.error) console.log(`             error: ${entry.error}`);
    }
    console.log(`  manifest: ${result.manifestPath}`);
    console.log(
      result.retention.applied
        ? `  retention: kept ${result.retention.keptRunIds.length} set(s), deleted ${result.retention.deletedFiles.length} file(s)`
        : `  retention: skipped (${result.retention.reason})`,
    );

    return result.ok;
  } catch (err) {
    if (err instanceof PreflightError) {
      console.error('SQLite backup aborted at preflight, no snapshot files were created:');
      for (const p of err.problems) console.error(`  ${p.name}: ${p.path}, ${p.reason}`);
    } else if (err instanceof CollisionError) {
      console.error(`SQLite backup aborted, destination(s) already exist for run id ${err.runId}:`);
      for (const f of err.existingFiles) console.error(`  ${f}`);
    } else {
      console.error('SQLite backup failed:', err instanceof Error ? err.message : String(err));
    }
    return false;
  }
}

const isDirectRun =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runCli().then((ok) => {
    process.exitCode = ok ? 0 : 1;
  });
}

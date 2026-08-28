import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Manual, CLI-only SQLite backup for the three production stores
 * (data/founder-os.db, data/bank.db, data/ledger.db). Deliberately NOT wired
 * into any API route, page, or scheduler; see scripts/backup-sqlite.ts for
 * the only invocation path, run by hand (`npm run backup:sqlite`) or from a
 * Railway shell. Uses better-sqlite3's wrapped SQLite Online Backup API
 * (`Database#backup()`), which produces a transactionally consistent copy of
 * a live WAL-mode database without stopping writers or requiring a manual
 * checkpoint.
 */

export type SourceDbName = 'founder-os' | 'bank' | 'ledger';

/** The exact, exhaustive set of sources every successful backup set must
 *  contain, no more and no fewer. Used both to build a run's snapshots and
 *  to validate an on-disk manifest before trusting it for retention. */
const REQUIRED_SOURCES: readonly SourceDbName[] = ['founder-os', 'bank', 'ledger'];

export type SourceDbSpec = {
  name: SourceDbName;
  path: string;
};

/** Deliberately a plain string map, not NodeJS.ProcessEnv: this is the only
 *  shape resolution actually needs, and it lets tests pass a bare fixture
 *  object without satisfying process.env's full interface. `process.env`
 *  itself is a structurally compatible argument. */
export type EnvLike = Record<string, string | undefined>;

/** Same env-var-or-default resolution lib/data.ts, lib/ledger.ts, and
 *  lib/bank.ts each use for their own DB path. Kept independent (no import
 *  from those modules) so this file never touches the app's long-lived
 *  getDb() singleton. */
export function resolveSourceDatabases(
  env: EnvLike = process.env,
  cwd: string = process.cwd(),
): SourceDbSpec[] {
  return [
    { name: 'founder-os', path: env.FOUNDER_OS_DB ?? path.join(cwd, 'data', 'founder-os.db') },
    { name: 'bank', path: env.BANK_DB ?? path.join(cwd, 'data', 'bank.db') },
    { name: 'ledger', path: env.LEDGER_DB ?? path.join(cwd, 'data', 'ledger.db') },
  ];
}

export const BACKUP_SUBDIR = 'backups';

/** Filesystem-safe UTC timestamp: ISO-8601 with every `:` replaced by `-`.
 *  Windows forbids `:` in filenames; `-`, `.`, digits, and letters are safe
 *  everywhere. Field widths are unchanged, so lexicographic string sort
 *  still equals chronological order across timestamps produced by this
 *  function (needed by applyRetention's newest-first sort). */
export function filesystemSafeTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/:/g, '-');
}

/** Matches exactly the shape filesystemSafeTimestamp produces:
 *  YYYY-MM-DDTHH-MM-SS.mmmZ. Anchored on both ends, no extra characters
 *  of any kind allowed either side. */
const TIMESTAMP_PATTERN = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}\\.\\d{3}Z';
const TIMESTAMP_RE = new RegExp(`^${TIMESTAMP_PATTERN}$`);

export function snapshotFilename(name: SourceDbName, timestamp: string): string {
  return `${name}-${timestamp}.db`;
}

export function manifestFilename(timestamp: string): string {
  return `manifest-${timestamp}.json`;
}

const SNAPSHOT_FILE_RE = new RegExp(`^(?:founder-os|bank|ledger)-${TIMESTAMP_PATTERN}\\.db$`);
const MANIFEST_FILE_RE = new RegExp(`^manifest-${TIMESTAMP_PATTERN}\\.json$`);

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

/**
 * True only for a bare filename (no directory component in either slash
 * style, on any platform) that exactly matches this module's snapshot
 * naming contract: `(founder-os|bank|ledger)-YYYY-MM-DDTHH-MM-SS.mmmZ.db`.
 * The explicit separator check matters because Node's `path.basename` is
 * platform-dependent: on POSIX it does not treat `\` as a separator at all,
 * so a value like `..\\..\\evil.db` would pass a basename-only check on
 * Linux (production) even though it is a Windows-style traversal attempt.
 * Retention consults this before ever unlinking anything, so a source .db,
 * a WAL/SHM sidecar, or any manipulated filename can never be a deletion
 * candidate.
 */
export function isOwnedSnapshotFile(filename: string): boolean {
  if (hasPathSeparator(filename)) return false;
  if (path.basename(filename) !== filename) return false;
  return SNAPSHOT_FILE_RE.test(filename);
}

/** Same contract as isOwnedSnapshotFile, for `manifest-<timestamp>.json`. */
export function isOwnedManifestFile(filename: string): boolean {
  if (hasPathSeparator(filename)) return false;
  if (path.basename(filename) !== filename) return false;
  return MANIFEST_FILE_RE.test(filename);
}

/**
 * Resolves `filename` against `backupDir` and unlinks it only if every one
 * of these holds: the name passes the relevant owned-file check (checked by
 * the caller before invoking this), the resolved path's parent directory is
 * exactly the resolved backup directory (blocks any traversal that a naming
 * check alone might miss), and the file actually exists. Returns whether a
 * file was removed, never throws for a path it refuses to touch.
 */
function unlinkWithinBackupDir(backupDir: string, filename: string): boolean {
  const resolvedDir = path.resolve(backupDir);
  const full = path.resolve(backupDir, filename);
  if (path.dirname(full) !== resolvedDir) return false;
  if (!fs.existsSync(full)) return false;
  fs.unlinkSync(full);
  return true;
}

export type PreflightProblem = { name: SourceDbName; path: string; reason: string };

/** Thrown when any source database is missing or fails to open. Carries
 *  every problem found, not just the first, so a single failing source
 *  never masquerades as "everything else is fine too". */
export class PreflightError extends Error {
  readonly problems: PreflightProblem[];

  constructor(problems: PreflightProblem[]) {
    super(
      `SQLite backup preflight failed for ${problems.length} source database(s): ` +
        problems.map((p) => `${p.name} (${p.reason})`).join(', '),
    );
    this.name = 'PreflightError';
    this.problems = problems;
  }
}

/** Thrown when a destination snapshot or manifest for the generated run id
 *  already exists on disk. Backing up must never overwrite a previous set,
 *  so this aborts the entire run before any file for the new run id is
 *  written. */
export class CollisionError extends Error {
  readonly runId: string;
  readonly existingFiles: string[];

  constructor(runId: string, existingFiles: string[]) {
    super(
      `SQLite backup aborted for run id ${runId}: destination file(s) already exist, refusing to overwrite: ` +
        existingFiles.join(', '),
    );
    this.name = 'CollisionError';
    this.runId = runId;
    this.existingFiles = existingFiles;
  }
}

export type OpenedSource = SourceDbSpec & { db: InstanceType<typeof Database> };

/**
 * Opens all three source databases read-only with `fileMustExist: true`, so
 * a missing path throws instead of better-sqlite3's default behavior of
 * silently creating an empty database in its place. All-or-nothing: if any
 * source is missing or unreadable, every already-opened connection is
 * closed and a single PreflightError is thrown naming every failing
 * source. Never a partial open, never a backup attempt for only some of
 * the three databases.
 */
export function openSourcesReadonly(specs: SourceDbSpec[]): OpenedSource[] {
  const opened: OpenedSource[] = [];
  const problems: PreflightProblem[] = [];

  for (const spec of specs) {
    if (!fs.existsSync(spec.path)) {
      problems.push({ name: spec.name, path: spec.path, reason: 'file does not exist' });
      continue;
    }
    try {
      const db = new Database(spec.path, { readonly: true, fileMustExist: true });
      try {
        // SQLite's file format is only validated on first page read; the
        // constructor above succeeds even for a non-database file (the
        // header check is lazy). Force that read now, at preflight time,
        // rather than letting it surface later as a confusing failure
        // mid-backup with a connection nobody closes.
        db.pragma('schema_version');
      } catch (err) {
        db.close();
        throw err;
      }
      opened.push({ ...spec, db });
    } catch (err) {
      problems.push({ name: spec.name, path: spec.path, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  if (problems.length > 0) {
    for (const o of opened) o.db.close();
    throw new PreflightError(problems);
  }

  return opened;
}

/** Runs the SQLite Online Backup API against an already-open source
 *  connection. Safe against a live WAL-mode writer: the backup reads a
 *  consistent snapshot without acquiring an exclusive lock for the whole
 *  copy. Creates destPath (that is the backup's own output file, not a
 *  source, so it is never guarded by fileMustExist). */
export async function backupOne(opened: OpenedSource, destPath: string): Promise<void> {
  await opened.db.backup(destPath);
}

export type IntegrityResult = { ok: boolean; detail: string[] };

export function verifyIntegrity(filePath: string): IntegrityResult {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.pragma('integrity_check') as { integrity_check: string }[];
    const detail = rows.map((r) => r.integrity_check);
    return { ok: detail.length === 1 && detail[0] === 'ok', detail };
  } finally {
    db.close();
  }
}

export function checksumFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** Tables whose unbounded growth this audit flagged (agent_messages, agent
 *  runs, broadcasts). Only founder-os.db has any of these; bank.db and
 *  ledger.db simply report null. A table missing entirely (older or
 *  different schema) is omitted from the result rather than faked as 0,
 *  matching the never-fake-a-number convention used elsewhere in this
 *  codebase. */
const GROWING_TABLES = ['agent_messages', 'agent_runs', 'broadcasts'] as const;

export function growingTableCounts(filePath: string): Record<string, number> | null {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const counts: Record<string, number> = {};
    for (const table of GROWING_TABLES) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
        counts[table] = row.n;
      } catch {
        // table doesn't exist in this database, so omit it rather than fake a 0
      }
    }
    return Object.keys(counts).length > 0 ? counts : null;
  } finally {
    db.close();
  }
}

export type SnapshotInspection = {
  integrity: IntegrityResult;
  sha256: string;
  bytes: number;
  rowCounts: Record<string, number> | null;
};

/**
 * Runs every post-backup check against one already-created snapshot file:
 * integrity_check, SHA-256, byte size, and growing-table row counts. Split
 * out from the run loop so it is independently callable, and so a test can
 * inject a replacement via RunBackupOptions.inspectSnapshot to deterministically
 * exercise the case where one of these steps throws after a snapshot was
 * already written to disk.
 */
export async function inspectSnapshot(destPath: string): Promise<SnapshotInspection> {
  const integrity = verifyIntegrity(destPath);
  const sha256 = await checksumFile(destPath);
  const bytes = fs.statSync(destPath).size;
  const rowCounts = growingTableCounts(destPath);
  return { integrity, sha256, bytes, rowCounts };
}

export type ManifestEntryStatus = 'ok' | 'integrity_failed' | 'snapshot_failed' | 'verification_failed';

export type ManifestEntry = {
  source: SourceDbName;
  sourcePath: string;
  filename: string;
  timestamp: string;
  status: ManifestEntryStatus;
  bytes: number | null;
  sha256: string | null;
  integrityDetail: string[] | null;
  rowCounts: Record<string, number> | null;
  /** Present only when status is 'snapshot_failed' (the .backup() call
   *  itself threw) or 'verification_failed' (a post-backup inspection step
   *  threw after the snapshot file was already created). */
  error?: string;
};

export type BackupManifest = {
  runId: string;
  createdAt: string;
  ok: boolean;
  backupDir: string;
  entries: ManifestEntry[];
};

export type RetentionResult = {
  applied: boolean;
  reason?: string;
  keptRunIds: string[];
  deletedFiles: string[];
};

export type BackupRunResult = {
  ok: boolean;
  manifest: BackupManifest;
  manifestPath: string;
  retention: RetentionResult;
};

type ValidatedSet = { runId: string; manifestFile: string; entryFilenames: string[] };

/**
 * Validates one on-disk manifest before it is ever trusted as a successful,
 * retention-eligible backup set. Returns null (never touched by retention)
 * unless every one of the following holds:
 *   - ok is exactly true;
 *   - runId is a string matching the exact filesystemSafeTimestamp shape;
 *   - the manifest's own filename on disk equals manifestFilename(runId);
 *   - entries is an array with exactly one entry per required source
 *     (REQUIRED_SOURCES), no duplicates, no unexpected or missing sources;
 *   - every entry's filename equals snapshotFilename(entry.source, runId)
 *     exactly, and independently passes isOwnedSnapshotFile.
 * A manifest that fails any of these checks (including one crafted with a
 * path-traversal filename, a mismatched runId, or a tampered source list)
 * is left alone: never deleted, never counted toward retention.
 */
function validateManifestForRetention(manifestFileOnDisk: string, parsed: unknown): ValidatedSet | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as { runId?: unknown; ok?: unknown; entries?: unknown };

  if (p.ok !== true) return null;
  if (typeof p.runId !== 'string' || !TIMESTAMP_RE.test(p.runId)) return null;
  if (manifestFileOnDisk !== manifestFilename(p.runId)) return null;
  if (!Array.isArray(p.entries)) return null;
  if (p.entries.length !== REQUIRED_SOURCES.length) return null;

  const seenSources = new Set<string>();
  const entryFilenames: string[] = [];

  for (const raw of p.entries) {
    if (typeof raw !== 'object' || raw === null) return null;
    const entry = raw as { source?: unknown; filename?: unknown };
    if (typeof entry.source !== 'string') return null;
    if (!REQUIRED_SOURCES.includes(entry.source as SourceDbName)) return null;
    if (seenSources.has(entry.source)) return null;
    seenSources.add(entry.source);

    const expectedFilename = snapshotFilename(entry.source as SourceDbName, p.runId);
    if (entry.filename !== expectedFilename) return null;
    if (!isOwnedSnapshotFile(expectedFilename)) return null;
    entryFilenames.push(expectedFilename);
  }

  if (seenSources.size !== REQUIRED_SOURCES.length) return null;

  return { runId: p.runId, manifestFile: manifestFileOnDisk, entryFilenames };
}

/**
 * Applies retention to an existing backups directory: keeps the `keep` most
 * recent successful sets (every manifest field validated by
 * validateManifestForRetention) and deletes the snapshot and manifest files
 * of any older successful sets beyond that count. A set whose manifest
 * records `ok: false`, or that fails structural validation for any reason,
 * is never a deletion candidate regardless of age; failed-run evidence and
 * unrecognized files are preserved until a human clears them. Every file
 * considered for deletion also passes unlinkWithinBackupDir's resolved-path
 * check immediately before unlinking.
 */
export function applyRetention(backupDir: string, keep: number): RetentionResult {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new RangeError(`keep must be an integer of at least 1, received ${keep}`);
  }

  let files: string[];
  try {
    files = fs.readdirSync(backupDir);
  } catch {
    return { applied: false, reason: 'backup directory not found', keptRunIds: [], deletedFiles: [] };
  }

  const successfulSets: ValidatedSet[] = [];
  for (const mf of files.filter(isOwnedManifestFile)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(backupDir, mf), 'utf8'));
    } catch {
      continue; // unparsable manifest, never touched
    }
    const validated = validateManifestForRetention(mf, parsed);
    if (validated) successfulSets.push(validated);
  }

  // Newest first. runId is filesystemSafeTimestamp output, which sorts
  // lexicographically in chronological order (see filesystemSafeTimestamp's doc).
  successfulSets.sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));

  const kept = successfulSets.slice(0, keep);
  const toDelete = successfulSets.slice(keep);
  const deletedFiles: string[] = [];

  for (const set of toDelete) {
    for (const filename of set.entryFilenames) {
      if (unlinkWithinBackupDir(backupDir, filename)) deletedFiles.push(filename);
    }
    if (unlinkWithinBackupDir(backupDir, set.manifestFile)) deletedFiles.push(set.manifestFile);
  }

  return { applied: true, keptRunIds: kept.map((s) => s.runId), deletedFiles };
}

export type RunBackupOptions = {
  cwd?: string;
  env?: EnvLike;
  now?: () => Date;
  /** Number of successful sets to retain. Default 3 per the Phase 1 policy.
   *  Must be an integer of at least 1; validated up front. */
  keep?: number;
  /** Test-only override for the post-backup inspection step. Defaults to
   *  the real inspectSnapshot export. Lets a test deterministically force a
   *  post-snapshot verification failure for one source while the others go
   *  through the real inspection unaffected. */
  inspectSnapshot?: (destPath: string) => Promise<SnapshotInspection>;
};

/**
 * Runs one full manual backup:
 *   1. Validates `keep`.
 *   2. Preflight: opens all three sources read-only. Throws PreflightError
 *      and creates no files at all if any source is missing or unreadable.
 *   3. Collision check: if a snapshot or manifest filename for the run id
 *      about to be used already exists on disk, throws CollisionError and
 *      creates no files. A backup never overwrites a previous set.
 *   4. For each source: snapshot via the Online Backup API, then inspect
 *      the snapshot (integrity_check, SHA-256, size, row counts). Either
 *      step failing is caught per source and recorded in that entry rather
 *      than aborting the whole run.
 *   5. Writes one manifest for the run. `ok` is true only if every source's
 *      entry status is 'ok'.
 *   6. Retention runs only when `ok` is true; a failed or partial run never
 *      triggers cleanup, so its evidence, including any snapshot files that
 *      were created before a later step failed, stays on disk for inspection.
 * Every opened database handle is closed in a finally block, regardless of
 * which step failed.
 */
export async function runBackup(options: RunBackupOptions = {}): Promise<BackupRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const keep = options.keep ?? 3;
  const inspect = options.inspectSnapshot ?? inspectSnapshot;

  if (!Number.isInteger(keep) || keep < 1) {
    throw new RangeError(`keep must be an integer of at least 1, received ${keep}`);
  }

  const specs = resolveSourceDatabases(env, cwd);
  const backupDir = path.join(cwd, 'data', BACKUP_SUBDIR);

  // All-or-nothing preflight. Throws before any directory or file is
  // created if a source is missing or unreadable, never a misleading
  // partial backup.
  const opened = openSourcesReadonly(specs);

  try {
    fs.mkdirSync(backupDir, { recursive: true });

    const startedAt = now();
    const timestamp = filesystemSafeTimestamp(startedAt);

    // Collision protection: refuse to overwrite a previous set. Checked
    // before any file for this run id is written.
    const expectedFilenames = [
      ...opened.map((src) => snapshotFilename(src.name, timestamp)),
      manifestFilename(timestamp),
    ];
    const collisions = expectedFilenames.filter((f) => fs.existsSync(path.join(backupDir, f)));
    if (collisions.length > 0) {
      throw new CollisionError(timestamp, collisions);
    }

    const entries: ManifestEntry[] = [];

    for (const src of opened) {
      const filename = snapshotFilename(src.name, timestamp);
      const destPath = path.join(backupDir, filename);

      try {
        await backupOne(src, destPath);
      } catch (err) {
        entries.push({
          source: src.name,
          sourcePath: src.path,
          filename,
          timestamp,
          status: 'snapshot_failed',
          bytes: null,
          sha256: null,
          integrityDetail: null,
          rowCounts: null,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      try {
        const inspection = await inspect(destPath);
        entries.push({
          source: src.name,
          sourcePath: src.path,
          filename,
          timestamp,
          status: inspection.integrity.ok ? 'ok' : 'integrity_failed',
          bytes: inspection.bytes,
          sha256: inspection.sha256,
          integrityDetail: inspection.integrity.detail,
          rowCounts: inspection.rowCounts,
        });
      } catch (err) {
        // The snapshot file already exists on disk at this point and is
        // preserved as failed-run evidence: it is never deleted here, and
        // retention below is skipped entirely because ok will be false.
        entries.push({
          source: src.name,
          sourcePath: src.path,
          filename,
          timestamp,
          status: 'verification_failed',
          bytes: null,
          sha256: null,
          integrityDetail: null,
          rowCounts: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const ok = entries.length === specs.length && entries.every((e) => e.status === 'ok');
    const manifest: BackupManifest = {
      runId: timestamp,
      createdAt: startedAt.toISOString(),
      ok,
      backupDir,
      entries,
    };
    const manifestPath = path.join(backupDir, manifestFilename(timestamp));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const retention = ok
      ? applyRetention(backupDir, keep)
      : { applied: false, reason: 'skipped: this run did not pass verification', keptRunIds: [], deletedFiles: [] };

    return { ok, manifest, manifestPath, retention };
  } finally {
    for (const src of opened) src.db.close();
  }
}

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Manual, CLI-only SQLite backup for the three production stores
 * (data/founder-os.db, data/bank.db, data/ledger.db). Deliberately NOT wired
 * into any API route, page, or scheduler; see scripts/backup-sqlite.ts for
 * the only on-volume invocation path, run by hand (`npm run backup:sqlite`)
 * or by the off-volume archival wrapper. Uses better-sqlite3's wrapped SQLite Online Backup API
 * (`Database#backup()`), which produces a transactionally consistent copy of
 * a live WAL-mode database without stopping writers or requiring a manual
 * checkpoint.
 *
 * founder-os.db is required: it must exist and open cleanly, or the whole
 * run aborts at preflight before any file is written. bank.db and ledger.db
 * are optional: both are separate, independently-created stores (see
 * lib/bank.ts and lib/ledger.ts) that legitimately do not exist until a
 * finance statement has been viewed or uploaded in the app. A missing
 * optional source is not a failure - it is recorded in the manifest as
 * 'not_present' and the run continues. A source that exists but fails to
 * open or validate is always a failure, required or not.
 */

export type SourceDbName = 'founder-os' | 'bank' | 'ledger';

/** The exact, exhaustive set of sources every successful backup manifest
 *  must name exactly once, no more and no fewer - independent of whether
 *  each one was actually backed up ('ok') or legitimately absent
 *  ('not_present'). Used both to build a run's entries and to validate an
 *  on-disk manifest before trusting it for retention. */
const KNOWN_SOURCES: readonly SourceDbName[] = ['founder-os', 'bank', 'ledger'];

/** The only source a backup run cannot proceed without. */
const REQUIRED_SOURCE: SourceDbName = 'founder-os';

export type SourceDbSpec = {
  name: SourceDbName;
  path: string;
  /** true only for founder-os.db. A missing required source aborts the run
   *  at preflight; a missing optional source is skipped, not a failure. */
  required: boolean;
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
    { name: 'founder-os', path: env.FOUNDER_OS_DB ?? path.join(cwd, 'data', 'founder-os.db'), required: true },
    { name: 'bank', path: env.BANK_DB ?? path.join(cwd, 'data', 'bank.db'), required: false },
    { name: 'ledger', path: env.LEDGER_DB ?? path.join(cwd, 'data', 'ledger.db'), required: false },
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
 * Opens each source database read-only with `fileMustExist: true`, so an
 * existing-but-unreadable/corrupt path throws instead of better-sqlite3's
 * default behavior of silently creating an empty database in its place.
 *
 * A missing REQUIRED source (founder-os.db) is a preflight problem. A
 * missing OPTIONAL source (bank.db, ledger.db) is silently skipped - it is
 * simply absent from the returned array, not a problem - because both are
 * legitimately created only after a specific in-app action and may not
 * exist yet. A source that exists but fails to open or validate is always
 * a problem, required or not: optional means "may be absent", never
 * "may be corrupt".
 *
 * All-or-nothing with respect to problems: if any problem is found, every
 * already-opened connection is closed and a single PreflightError is
 * thrown naming every failing source. Never a partial open on failure.
 */
export function openSourcesReadonly(specs: SourceDbSpec[]): OpenedSource[] {
  const opened: OpenedSource[] = [];
  const problems: PreflightProblem[] = [];

  for (const spec of specs) {
    if (!fs.existsSync(spec.path)) {
      if (spec.required) {
        problems.push({ name: spec.name, path: spec.path, reason: 'file does not exist' });
      }
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

/**
 * `<filename>-wal`/`<filename>-shm` sidecars a snapshot can end up with.
 * Root cause: the Online Backup API copies the source's raw page 1
 * verbatim, including the file-format-version bytes that mark a WAL-mode
 * database (all three source stores run `PRAGMA journal_mode = WAL`, see
 * lib/db.ts, lib/bank.ts, lib/ledger.ts). The destination snapshot inherits
 * that "WAL format" flag even though no separate WAL file was ever written
 * for it during the backup itself. Any subsequent open of the snapshot -
 * verifyIntegrity or growingTableCounts during inspectSnapshot, or a future
 * manual restore/verify - then makes SQLite create -wal/-shm sidecars just
 * to satisfy a WAL-format read, purely as a read-time side effect.
 */
export type SidecarCleanupResult =
  | { status: 'clean'; deleted: string[] }
  | { status: 'wal_nonempty'; walBytes: number };

/**
 * Cleans up the -wal/-shm sidecars for one snapshot, called only after every
 * handle opened against it (by inspectSnapshot's verifyIntegrity and
 * growingTableCounts, both of which close in a finally block) has already
 * closed. `filename` MUST already be a filename that has passed
 * isOwnedSnapshotFile - this function refuses to run otherwise, since a
 * sidecar path may only ever be derived from an already-validated owned
 * snapshot filename, never from an arbitrary string. The sidecar paths are
 * built by string-appending '-wal'/'-shm' to that exact filename and
 * resolving the result against backupDir; there is no directory scan and no
 * glob, so nothing other than this exact snapshot's own sidecars can ever be
 * touched. A non-empty WAL means the on-disk .db alone is not the true final
 * state - some committed data may exist only in the WAL - so it is never
 * silently deleted: this returns 'wal_nonempty' and leaves the snapshot, its
 * WAL, and any SHM completely untouched as evidence. A zero-byte WAL carries
 * no data and is safe to delete; the SHM (a shared-memory index, meaningless
 * without a WAL) is only deleted once no non-empty WAL remains.
 */
export function cleanupSnapshotSidecars(backupDir: string, filename: string): SidecarCleanupResult {
  if (!isOwnedSnapshotFile(filename)) {
    throw new Error(`refusing to derive sidecar paths from an unvalidated filename: ${filename}`);
  }

  const resolvedDir = path.resolve(backupDir);
  const walName = `${filename}-wal`;
  const shmName = `${filename}-shm`;
  const walPath = path.resolve(backupDir, walName);
  const shmPath = path.resolve(backupDir, shmName);

  // filename is already proven separator-free by isOwnedSnapshotFile, so
  // these resolve to direct children of backupDir by construction - this is
  // a second, independent check of that fact, mirroring
  // unlinkWithinBackupDir's own resolved-parent guard.
  if (path.dirname(walPath) !== resolvedDir || path.dirname(shmPath) !== resolvedDir) {
    throw new Error(`sidecar path escaped the backup directory for filename: ${filename}`);
  }

  const deleted: string[] = [];

  if (fs.existsSync(walPath)) {
    const walBytes = fs.statSync(walPath).size;
    if (walBytes > 0) {
      return { status: 'wal_nonempty', walBytes };
    }
    fs.unlinkSync(walPath);
    deleted.push(walName);
  }

  if (fs.existsSync(shmPath)) {
    fs.unlinkSync(shmPath);
    deleted.push(shmName);
  }

  return { status: 'clean', deleted };
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

/** 'not_present' is not a failure: it marks an optional source (bank,
 *  ledger) that does not exist on disk yet and was cleanly skipped. */
export type ManifestEntryStatus = 'ok' | 'not_present' | 'integrity_failed' | 'snapshot_failed' | 'verification_failed';

export type ManifestEntry = {
  source: SourceDbName;
  sourcePath: string;
  /** null only when status is 'not_present' - no snapshot file was ever created for this entry. */
  filename: string | null;
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
 *   - entries is an array with exactly one entry per known source
 *     (KNOWN_SOURCES), no duplicates, no unexpected or missing sources;
 *   - the founder-os entry has status 'ok' with filename equal to
 *     snapshotFilename('founder-os', runId), and independently passes
 *     isOwnedSnapshotFile - founder-os can never be 'not_present' in a
 *     trustworthy manifest;
 *   - each optional entry (bank, ledger) has EITHER status 'ok' with a
 *     filename equal to snapshotFilename(source, runId) that independently
 *     passes isOwnedSnapshotFile, OR status 'not_present' with filename,
 *     bytes, sha256, integrityDetail and rowCounts all null/absent - never
 *     a filename or file metadata attached to a 'not_present' entry.
 * A manifest that fails any of these checks (including one crafted with a
 * path-traversal filename, a mismatched runId, a tampered source list, or a
 * 'not_present' entry smuggling a filename) is left alone: never deleted,
 * never counted toward retention. Only entries that were actually verified
 * 'ok' contribute a filename to entryFilenames - retention never invents or
 * deletes a file for a 'not_present' entry.
 */
function validateManifestForRetention(manifestFileOnDisk: string, parsed: unknown): ValidatedSet | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = parsed as { runId?: unknown; ok?: unknown; entries?: unknown };

  if (p.ok !== true) return null;
  if (typeof p.runId !== 'string' || !TIMESTAMP_RE.test(p.runId)) return null;
  if (manifestFileOnDisk !== manifestFilename(p.runId)) return null;
  if (!Array.isArray(p.entries)) return null;
  if (p.entries.length !== KNOWN_SOURCES.length) return null;

  const seenSources = new Set<string>();
  const entryFilenames: string[] = [];

  for (const raw of p.entries) {
    if (typeof raw !== 'object' || raw === null) return null;
    const entry = raw as {
      source?: unknown;
      status?: unknown;
      filename?: unknown;
      bytes?: unknown;
      sha256?: unknown;
      integrityDetail?: unknown;
      rowCounts?: unknown;
    };
    if (typeof entry.source !== 'string') return null;
    if (!KNOWN_SOURCES.includes(entry.source as SourceDbName)) return null;
    if (seenSources.has(entry.source)) return null;
    seenSources.add(entry.source);

    const isRequired = entry.source === REQUIRED_SOURCE;

    if (entry.status === 'not_present') {
      // Absence is only ever legitimate for an optional source, and only
      // when nothing that looks like a real snapshot is attached to it.
      if (isRequired) return null;
      if (entry.filename !== null) return null;
      if (entry.bytes !== undefined && entry.bytes !== null) return null;
      if (entry.sha256 !== undefined && entry.sha256 !== null) return null;
      if (entry.integrityDetail !== undefined && entry.integrityDetail !== null) return null;
      if (entry.rowCounts !== undefined && entry.rowCounts !== null) return null;
      continue;
    }

    if (entry.status !== 'ok') return null;
    const expectedFilename = snapshotFilename(entry.source as SourceDbName, p.runId);
    if (entry.filename !== expectedFilename) return null;
    if (!isOwnedSnapshotFile(expectedFilename)) return null;
    entryFilenames.push(expectedFilename);
  }

  if (seenSources.size !== KNOWN_SOURCES.length) return null;

  return { runId: p.runId, manifestFile: manifestFileOnDisk, entryFilenames };
}

/**
 * Applies retention to an existing backups directory: keeps the `keep` most
 * recent successful sets (every manifest field validated by
 * validateManifestForRetention) and deletes the snapshot and manifest files
 * of any older successful sets beyond that count, plus any -wal/-shm
 * sidecars still orphaned next to a deleted snapshot (a successful run
 * already cleans its own via cleanupSnapshotSidecars, but this catches
 * sidecars left by an older backup or a manual restore). A set whose
 * manifest records `ok: false`, or that fails structural validation for any
 * reason, is never a deletion candidate regardless of age; failed-run
 * evidence and unrecognized files are preserved until a human clears them.
 * Every file considered for deletion, sidecars included, also passes
 * unlinkWithinBackupDir's resolved-path check immediately before unlinking,
 * and every sidecar name is derived only by appending onto a filename
 * validateManifestForRetention already proved passes isOwnedSnapshotFile.
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
      // Orphaned sidecars belonging exactly to this validated owned
      // snapshot (see cleanupSnapshotSidecars's doc for how they can arise).
      // Derived only by string-appending onto `filename`, which
      // validateManifestForRetention already proved passes
      // isOwnedSnapshotFile - never a glob, never a directory scan.
      const walName = `${filename}-wal`;
      if (unlinkWithinBackupDir(backupDir, walName)) deletedFiles.push(walName);
      const shmName = `${filename}-shm`;
      if (unlinkWithinBackupDir(backupDir, shmName)) deletedFiles.push(shmName);
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
 *   2. Preflight: opens every source read-only. founder-os.db is required -
 *      missing or unreadable throws PreflightError and creates no files at
 *      all. bank.db/ledger.db are optional - missing is not a problem and
 *      is recorded later as 'not_present', but existing-and-unreadable
 *      still throws PreflightError, same as a required source.
 *   3. Collision check: only for sources that will actually produce a
 *      snapshot this run (i.e. the ones preflight opened) plus the
 *      manifest. If a snapshot or manifest filename for the run id about
 *      to be used already exists on disk, throws CollisionError and
 *      creates no files. A backup never overwrites a previous set.
 *   4. For each opened source: snapshot via the Online Backup API, then
 *      inspect the snapshot (integrity_check, SHA-256, size, row counts),
 *      then clean up any -wal/-shm sidecars that inspection left behind
 *      (see cleanupSnapshotSidecars's doc for why they can appear at all). A
 *      zero-byte WAL/its SHM are deleted; a non-empty WAL overrides an
 *      otherwise-successful entry to 'verification_failed' and leaves the
 *      snapshot, WAL, and SHM in place as evidence. Either the snapshot or
 *      inspection step failing is caught per source and recorded in that
 *      entry rather than aborting the whole run. Each optional source that
 *      was absent at preflight gets a 'not_present' entry instead, with no
 *      filename and no file metadata.
 *   5. Writes one manifest for the run, always with exactly one entry per
 *      known source. `ok` is true only when founder-os's entry is 'ok' AND
 *      every optional source's entry is either 'ok' or 'not_present'.
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

  // Preflight. Throws before any directory or file is created if the
  // required source (founder-os) is missing, or if ANY source that does
  // exist is unreadable/corrupt. A missing OPTIONAL source (bank, ledger)
  // is not a problem here - it simply will not appear in `opened`.
  const opened = openSourcesReadonly(specs);

  try {
    fs.mkdirSync(backupDir, { recursive: true });

    const startedAt = now();
    const timestamp = filesystemSafeTimestamp(startedAt);

    // Collision protection: refuse to overwrite a previous set. Checked
    // before any file for this run id is written. Only sources that will
    // actually produce a snapshot this run (`opened`) are checked - an
    // absent optional source has no destination file, so nothing to collide
    // with.
    const expectedFilenames = [
      ...opened.map((src) => snapshotFilename(src.name, timestamp)),
      manifestFilename(timestamp),
    ];
    const collisions = expectedFilenames.filter((f) => fs.existsSync(path.join(backupDir, f)));
    if (collisions.length > 0) {
      throw new CollisionError(timestamp, collisions);
    }

    const entries: ManifestEntry[] = [];

    for (const spec of specs) {
      const src = opened.find((o) => o.name === spec.name);
      if (!src) {
        // openSourcesReadonly guarantees this can only be an optional
        // source that was cleanly absent - a missing required source, or
        // any corrupt source, would already have thrown PreflightError
        // above. No file is created and none is expected to exist.
        entries.push({
          source: spec.name,
          sourcePath: spec.path,
          filename: null,
          timestamp,
          status: 'not_present',
          bytes: null,
          sha256: null,
          integrityDetail: null,
          rowCounts: null,
        });
        continue;
      }

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
        let entry: ManifestEntry = {
          source: src.name,
          sourcePath: src.path,
          filename,
          timestamp,
          status: inspection.integrity.ok ? 'ok' : 'integrity_failed',
          bytes: inspection.bytes,
          sha256: inspection.sha256,
          integrityDetail: inspection.integrity.detail,
          rowCounts: inspection.rowCounts,
        };

        // Sidecar cleanup only runs here, after inspect() has returned and
        // every handle it opened is already closed: inspecting the snapshot
        // is what can create -wal/-shm in the first place (see
        // cleanupSnapshotSidecars's doc). A non-empty WAL overrides an
        // otherwise-successful entry to verification_failed - a successful
        // backup set must never report success while its .db alone omits
        // data that only exists in a leftover WAL.
        const sidecars = cleanupSnapshotSidecars(backupDir, filename);
        if (sidecars.status === 'wal_nonempty') {
          entry = {
            source: src.name,
            sourcePath: src.path,
            filename,
            timestamp,
            status: 'verification_failed',
            bytes: null,
            sha256: null,
            integrityDetail: null,
            rowCounts: null,
            error: `snapshot WAL sidecar is non-empty (${sidecars.walBytes} bytes) after inspection; preserving snapshot, WAL, and SHM as evidence instead of reporting success`,
          };
        }

        entries.push(entry);
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

    // ok requires the required source (founder-os) to have actually
    // succeeded, and every optional source to be either verified 'ok' or
    // cleanly 'not_present' - never a failure status for any of them.
    // `entries` and `specs` are built in the same order (one entry per
    // spec, no skips), so a same-index zip is exact.
    const ok =
      entries.length === specs.length &&
      specs.every((spec, i) => {
        const status = entries[i].status;
        return spec.required ? status === 'ok' : status === 'ok' || status === 'not_present';
      });
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

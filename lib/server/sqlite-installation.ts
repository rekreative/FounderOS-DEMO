import Database from 'better-sqlite3';
import { InstallationMarkerInvalidError, InstallationSqliteUnavailableError } from './installation-errors';

/**
 * The SQLite half of the REKREOS Phase 2 installation marker. A small,
 * dedicated metadata table - deliberately separate from every table
 * lib/db.ts/lib/seed.ts own, so the identity never lands in seeded business
 * data and ordinary lib/data.ts getDb() calls never touch this module at
 * all. Only lib/server/installation-registration.ts's registerInstallation()
 * (via the `npm run register:installation` CLI) ever writes here, and only
 * once - readSqliteInstallation() is a pure read-only probe used by both
 * the registration CLI and lib/server/installation-ready.ts.
 *
 * Every function below opens with `fileMustExist: true` and never creates a
 * missing database file - a missing/corrupt/`:memory:` database is always a
 * hard failure (InstallationSqliteUnavailableError), never silently
 * papered over.
 */

export const INSTALLATION_STORE_NAME = 'founder-os';
export const INSTALLATION_TABLE = 'installation_metadata';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidInstallationId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export type SqliteInstallationRow = {
  installationId: string;
  registeredAt: string;
};

type SqliteDatabase = InstanceType<typeof Database>;

function closeQuietly(db: SqliteDatabase | undefined): void {
  if (!db) return;
  try {
    db.close();
  } catch {
    // best-effort only - the caller already has (or is about to throw) the
    // real error that matters.
  }
}

/** Opens read-only, `fileMustExist: true`, and forces one cheap page read so
 *  a corrupt (non-SQLite) file fails here rather than on first real query -
 *  same technique lib/server/sqlite-ready.ts uses. Never creates the file. */
function openReadOnly(dbPath: string): SqliteDatabase {
  if (dbPath === ':memory:') throw new InstallationSqliteUnavailableError();
  let db: SqliteDatabase | undefined;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('schema_version');
    return db;
  } catch {
    closeQuietly(db);
    throw new InstallationSqliteUnavailableError();
  }
}

/** Opens read-write, `fileMustExist: true` - never creates the file. */
function openReadWrite(dbPath: string): SqliteDatabase {
  if (dbPath === ':memory:') throw new InstallationSqliteUnavailableError();
  let db: SqliteDatabase | undefined;
  try {
    db = new Database(dbPath, { fileMustExist: true });
    db.pragma('schema_version');
    return db;
  } catch {
    closeQuietly(db);
    throw new InstallationSqliteUnavailableError();
  }
}

function ensureTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${INSTALLATION_TABLE} (
      store_name TEXT PRIMARY KEY CHECK (store_name = '${INSTALLATION_STORE_NAME}'),
      installation_id TEXT NOT NULL,
      registered_at TEXT NOT NULL
    );
  `);
}

type StoredRow = { installation_id: string; registered_at: string };

/**
 * Read-only probe. Returns null when the table or the row is legitimately
 * absent (a store that has never been registered - not an error). Throws
 * InstallationSqliteUnavailableError for a missing/corrupt/`:memory:`
 * database, and InstallationMarkerInvalidError if a row exists whose
 * installation_id is not a well-formed UUID. Always closes its handle.
 */
export function readSqliteInstallation(dbPath: string): SqliteInstallationRow | null {
  const db = openReadOnly(dbPath);
  try {
    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(INSTALLATION_TABLE);
    if (!tableExists) return null;

    const row = db
      .prepare(`SELECT installation_id, registered_at FROM ${INSTALLATION_TABLE} WHERE store_name = ?`)
      .get(INSTALLATION_STORE_NAME) as StoredRow | undefined;
    if (!row) return null;

    if (!isValidInstallationId(row.installation_id)) throw new InstallationMarkerInvalidError();
    return { installationId: row.installation_id, registeredAt: row.registered_at };
  } finally {
    db.close();
  }
}

/**
 * Read-write, but never creates a missing database file. Creates the
 * metadata TABLE if absent (structure only - not the identity) and writes
 * the identity row ONLY when no row exists yet. An existing row is always
 * returned unchanged and is never overwritten.
 */
export function writeSqliteInstallationIfAbsent(
  dbPath: string,
  installationId: string,
  registeredAt: string,
): SqliteInstallationRow {
  // Defense in depth: registerInstallation() already validates a
  // generated/caller-supplied id before calling this function, but this
  // function must never trust that - a bad id from any future caller must
  // never reach the filesystem. Checked before openReadWrite() so a bad id
  // never even opens (let alone creates the table in) the database file.
  if (!isValidInstallationId(installationId)) throw new InstallationMarkerInvalidError();

  const db = openReadWrite(dbPath);
  try {
    ensureTable(db);

    const existing = db
      .prepare(`SELECT installation_id, registered_at FROM ${INSTALLATION_TABLE} WHERE store_name = ?`)
      .get(INSTALLATION_STORE_NAME) as StoredRow | undefined;
    if (existing) {
      if (!isValidInstallationId(existing.installation_id)) throw new InstallationMarkerInvalidError();
      return { installationId: existing.installation_id, registeredAt: existing.registered_at };
    }

    db.prepare(
      `INSERT INTO ${INSTALLATION_TABLE} (store_name, installation_id, registered_at) VALUES (?, ?, ?)`,
    ).run(INSTALLATION_STORE_NAME, installationId, registeredAt);
    return { installationId, registeredAt };
  } finally {
    db.close();
  }
}

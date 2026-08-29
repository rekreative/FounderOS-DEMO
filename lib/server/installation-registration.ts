import crypto from 'node:crypto';
import {
  InstallationMarkerInvalidError,
  InstallationMismatchError,
  InstallationOrphanedPostgresError,
} from './installation-errors';
import { isValidInstallationId, readSqliteInstallation, writeSqliteInstallationIfAbsent } from './sqlite-installation';

/**
 * REKREOS Phase 2 installation-marker registration state machine, driven by
 * `npm run register:installation` (scripts/register-installation.ts). Never
 * called from application/route code - this is an explicit, human-run,
 * idempotent CLI operation, not something that runs on every boot.
 *
 * `pg` is a minimal duck-typed interface (query() only) so tests can pass a
 * plain fake object; a real `pg.Client` or `pg.Pool` satisfies it exactly.
 */
export const INSTALLATION_STORE_NAME = 'founder-os';
export const PG_INSTALLATIONS_TABLE = 'sqlite_installations';

/**
 * Deliberately not generic: every query this module issues resolves rows
 * shaped `{ installation_id }`, and a non-generic method here lets a plain
 * fake object satisfy this interface in tests - a generic `query<T>(...)`
 * method can't be structurally satisfied by any single concrete
 * implementation, since the interface would promise a `T[]` result for
 * whatever T a caller chooses.
 */
export interface InstallationPgClient {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Array<{ installation_id?: string }> }>;
}

export type InstallationRegistrationOutcome = 'registered' | 'already_registered' | 'completed_interrupted';

export interface RegisterInstallationOptions {
  /** Explicit path to founder-os.db - never defaulted or guessed. */
  sqlitePath: string;
  pg: InstallationPgClient;
  now?: () => Date;
  generateId?: () => string;
}

export interface InstallationRegistrationResult {
  outcome: InstallationRegistrationOutcome;
}

async function readPgInstallationId(pg: InstallationPgClient): Promise<string | null> {
  const { rows } = await pg.query(
    `SELECT installation_id FROM ${PG_INSTALLATIONS_TABLE} WHERE store_name = $1`,
    [INSTALLATION_STORE_NAME],
  );
  return rows[0]?.installation_id ?? null;
}

/** INSERT ... ON CONFLICT DO NOTHING, then re-read - never overwrites a row
 *  a concurrent run may have already inserted. Returns whatever ends up
 *  stored (ours, or a concurrent run's), never assumed to be ours. */
async function insertPgInstallationIfAbsent(pg: InstallationPgClient, installationId: string): Promise<string> {
  await pg.query(
    `INSERT INTO ${PG_INSTALLATIONS_TABLE} (store_name, installation_id) VALUES ($1, $2) ON CONFLICT (store_name) DO NOTHING`,
    [INSTALLATION_STORE_NAME, installationId],
  );
  const stored = await readPgInstallationId(pg);
  if (!stored) throw new InstallationMarkerInvalidError();
  return stored;
}

/**
 * Runs the full safe-state matrix from the REKREOS Phase 2 spec:
 *
 * - neither marker exists            -> generate + write SQLite, then Postgres ('registered')
 * - both exist and match             -> no-op ('already_registered')
 * - SQLite exists, Postgres absent   -> register Postgres from the existing SQLite id ('completed_interrupted')
 * - Postgres exists, SQLite absent   -> hard fail (InstallationOrphanedPostgresError), never touches SQLite
 * - both exist and differ            -> hard fail (InstallationMismatchError), overwrites neither
 * - SQLite missing/corrupt/`:memory:` -> hard fail (InstallationSqliteUnavailableError) before Postgres is ever touched
 */
export async function registerInstallation(
  options: RegisterInstallationOptions,
): Promise<InstallationRegistrationResult> {
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? (() => crypto.randomUUID());

  // Read SQLite first: a missing/corrupt/:memory: database must hard-fail
  // before Postgres is ever queried, let alone written.
  const sqliteRow = readSqliteInstallation(options.sqlitePath);
  const pgId = await readPgInstallationId(options.pg);

  if (!sqliteRow && !pgId) {
    const generatedId = generateId();
    // A generated (or, via a test override, caller-supplied) id must be
    // validated before it ever touches either store - writing an invalid
    // id to SQLite first and only discovering the problem when Postgres's
    // UUID column rejects it would leave a permanently corrupt SQLite row
    // behind (writeSqliteInstallationIfAbsent never overwrites an existing
    // row, valid or not). Failing here, before any write, keeps this a
    // true no-op on the invalid-id path.
    if (!isValidInstallationId(generatedId)) throw new InstallationMarkerInvalidError();
    const registeredAt = now().toISOString();

    // Concurrent-registration safety: two racing registrars can both
    // observe "neither marker exists" before either has written anything
    // (both read SQLite and Postgres before either write happens). If a
    // concurrent run already won the SQLite write race,
    // writeSqliteInstallationIfAbsent() returns THAT existing row instead
    // of writing this run's generatedId - it never overwrites. The
    // installation id inserted into Postgres below must always be the
    // actual persisted SQLite identity (`persisted.installationId`), never
    // the local `generatedId`: using the local value here would let this
    // run propose a different id than what SQLite actually holds, which
    // (depending on which run's Postgres INSERT happens to land first) can
    // leave SQLite and Postgres permanently holding two different ids -
    // a split-brain neither side's write function is ever allowed to fix.
    const persisted = writeSqliteInstallationIfAbsent(options.sqlitePath, generatedId, registeredAt);
    const stored = await insertPgInstallationIfAbsent(options.pg, persisted.installationId);
    if (stored !== persisted.installationId) throw new InstallationMismatchError();
    return { outcome: 'registered' };
  }

  if (sqliteRow && !pgId) {
    const stored = await insertPgInstallationIfAbsent(options.pg, sqliteRow.installationId);
    if (stored !== sqliteRow.installationId) throw new InstallationMismatchError();
    return { outcome: 'completed_interrupted' };
  }

  if (!sqliteRow && pgId) {
    throw new InstallationOrphanedPostgresError();
  }

  // Both exist at this point.
  if (sqliteRow!.installationId === pgId) {
    return { outcome: 'already_registered' };
  }
  throw new InstallationMismatchError();
}

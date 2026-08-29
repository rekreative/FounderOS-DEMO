/**
 * REKREOS Phase 2 installation marker - shared error types for
 * lib/server/sqlite-installation.ts and lib/server/installation-registration.ts.
 * Every message is a fixed, generic string: none of them ever carries a
 * path, UUID, connection string, or raw underlying error, so it is safe to
 * let these propagate into CLI output or logs without a leak.
 */

export class InstallationSqliteUnavailableError extends Error {
  constructor() {
    super('the SQLite installation marker could not be read: the database is missing, unreadable, or not a persisted file');
    this.name = 'InstallationSqliteUnavailableError';
  }
}

export class InstallationMarkerInvalidError extends Error {
  constructor() {
    super('an installation marker was found but is not a valid identifier');
    this.name = 'InstallationMarkerInvalidError';
  }
}

export class InstallationMismatchError extends Error {
  constructor() {
    super('the SQLite and Postgres installation markers do not match');
    this.name = 'InstallationMismatchError';
  }
}

export class InstallationOrphanedPostgresError extends Error {
  constructor() {
    super('a Postgres installation marker exists but no SQLite marker was found; refusing to create one automatically');
    this.name = 'InstallationOrphanedPostgresError';
  }
}

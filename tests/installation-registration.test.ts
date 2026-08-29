import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Client } from 'pg';
import {
  registerInstallation,
  type InstallationPgClient,
} from '@/lib/server/installation-registration';
import {
  InstallationMarkerInvalidError,
  InstallationMismatchError,
  InstallationOrphanedPostgresError,
  InstallationSqliteUnavailableError,
} from '@/lib/server/installation-errors';
import { INSTALLATION_TABLE, readSqliteInstallation } from '@/lib/server/sqlite-installation';
import { resolveTestDatabaseUrl } from './helpers/pg-test-env';

/**
 * lib/server/installation-registration.ts - the registration state machine
 * (REKREOS Phase 2). Exercised here with a fake, in-memory Postgres client
 * (a plain object implementing InstallationPgClient's query() shape) and
 * real temp SQLite files, so the full six-state matrix from the task spec
 * runs with no real database of either kind. A conditional real-Postgres
 * block at the bottom (gated on DATABASE_URL, same pattern as
 * tests/server-migrate.test.ts) additionally proves the SQL itself is
 * correct against a live sqlite_installations table.
 */

const FIXED_UUID = '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e';
const OTHER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type LoggedQuery = { text: string; params: unknown[] };

/**
 * Observable fake: every query is recorded in `queryLog` in true invocation
 * order (regardless of when its promise settles), so tests can assert
 * exactly what was read/written - not just the final row. A bare
 * `expect(pg.rows).toEqual([])`-style check on an unused property proves
 * nothing about whether an INSERT actually ran; `insertCount`/`selectCount`
 * and `queryLog` are what make "zero writes" or "exactly one INSERT" a real
 * assertion instead of an assumption.
 */
function makeFakePg(initialRow: { installation_id: string } | null = null) {
  let row = initialRow;
  const queryLog: LoggedQuery[] = [];

  const client: InstallationPgClient = {
    async query(text: string, params: unknown[] = []) {
      queryLog.push({ text, params: [...params] });
      if (/^SELECT installation_id FROM sqlite_installations/.test(text)) {
        return { rows: row ? [row] : [] };
      }
      if (/^INSERT INTO sqlite_installations/.test(text)) {
        if (!row) row = { installation_id: params[1] as string };
        return { rows: [] };
      }
      throw new Error(`unexpected query in fake pg client: ${text}`);
    },
  };

  // Plain methods, not getters: `const { insertCount } = makeFakePg(...)`
  // would otherwise destructure a getter into a one-time snapshot value
  // (evaluated once, at destructuring time) rather than a live read - every
  // "count after further operations" assertion below relies on these
  // staying live across the whole test.
  return {
    client,
    queryLog,
    selectCount: () => queryLog.filter((q) => /^SELECT/.test(q.text)).length,
    insertCount: () => queryLog.filter((q) => /^INSERT/.test(q.text)).length,
  };
}

/**
 * Fully deterministic concurrency harness: every query is logged
 * immediately (invocation order) but its promise resolution is deliberately
 * withheld until `releaseNext(matcher)` is called - a controlled stand-in
 * for two real, concurrent registrars each blocked on their own Postgres
 * round-trip. `row` mutates only when an INSERT is actually released,
 * mirroring exactly when a real database would apply the write.
 */
function makeSequencedPg(initialRow: { installation_id: string } | null = null) {
  let row = initialRow;
  const queryLog: LoggedQuery[] = [];
  // Once true, every NEW query resolves immediately instead of queuing -
  // used once the interesting race window is over, so a trailing
  // "does re-running now behave correctly" call (which issues its own,
  // otherwise-unreleased query) doesn't hang the test forever waiting for a
  // manual release that will never come.
  let autoRelease = false;

  function resolveFor(text: string, params: unknown[]): { rows: Array<{ installation_id?: string }> } {
    if (/^SELECT installation_id FROM sqlite_installations/.test(text)) {
      return { rows: row ? [row] : [] };
    }
    if (/^INSERT INTO sqlite_installations/.test(text)) {
      if (!row) row = { installation_id: params[1] as string };
      return { rows: [] };
    }
    throw new Error(`unexpected query in sequenced fake pg client: ${text}`);
  }

  type Pending = { text: string; params: unknown[]; release: () => void };
  const pending: Pending[] = [];

  const client: InstallationPgClient = {
    query(text: string, params: unknown[] = []) {
      queryLog.push({ text, params: [...params] });
      if (autoRelease) return Promise.resolve(resolveFor(text, params));
      return new Promise((resolve) => {
        pending.push({ text, params, release: () => resolve(resolveFor(text, params)) });
      });
    },
  };

  function releaseNext(matcher: (q: Pending) => boolean): void {
    const idx = pending.findIndex(matcher);
    if (idx === -1) {
      throw new Error(`no pending query matched the given predicate (pending: ${pending.map((p) => p.text).join(' | ')})`);
    }
    const [entry] = pending.splice(idx, 1);
    entry.release();
  }

  return {
    client,
    queryLog,
    pendingCount: () => pending.length,
    releaseNextSelect: () => releaseNext((q) => /^SELECT/.test(q.text)),
    releaseNextInsert: () => releaseNext((q) => /^INSERT/.test(q.text)),
    enableAutoRelease: () => {
      autoRelease = true;
    },
  };
}

/** Flushes the entire microtask queue - safe regardless of how many `await`
 *  hops separate a resolved fake-pg promise from the point where the
 *  resulting synchronous code (e.g. a real SQLite write) actually runs. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

let tmp: string | undefined;

function makeDb(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'installation-registration-'));
  const dbPath = path.join(tmp, 'founder-os.db');
  new Database(dbPath).close();
  return dbPath;
}

afterEach(() => {
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
  }
});

describe('registerInstallation - state machine', () => {
  it('neither marker exists: generates a UUID, writes it to SQLite, then registers it in Postgres with exactly one INSERT', async () => {
    const dbPath = makeDb();
    const { client: pg, insertCount, selectCount } = makeFakePg(null);

    const result = await registerInstallation({ sqlitePath: dbPath, pg, generateId: () => FIXED_UUID, now: () => new Date('2026-08-29T00:00:00.000Z') });

    expect(result).toEqual({ outcome: 'registered' });
    expect(readSqliteInstallation(dbPath)).toEqual({ installationId: FIXED_UUID, registeredAt: '2026-08-29T00:00:00.000Z' });
    expect(insertCount()).toBe(1);
    expect(selectCount()).toBe(2); // initial "does it exist" read + the re-read after INSERT
  });

  it('both exist and match (already_registered): performs zero writes', async () => {
    const dbPath = makeDb();
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE ${INSTALLATION_TABLE} (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO ${INSTALLATION_TABLE} VALUES ('founder-os', ?, ?)`).run(FIXED_UUID, '2026-08-29T00:00:00.000Z');
    db.close();
    const { client: pg, insertCount, selectCount } = makeFakePg({ installation_id: FIXED_UUID });

    const result = await registerInstallation({ sqlitePath: dbPath, pg });

    expect(result).toEqual({ outcome: 'already_registered' });
    expect(readSqliteInstallation(dbPath)?.installationId).toBe(FIXED_UUID);
    expect(insertCount()).toBe(0);
    expect(selectCount()).toBe(1);
  });

  it('SQLite marker exists, Postgres absent (completed_interrupted): performs exactly one safe INSERT attempt, using the existing SQLite UUID', async () => {
    const dbPath = makeDb();
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE ${INSTALLATION_TABLE} (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO ${INSTALLATION_TABLE} VALUES ('founder-os', ?, ?)`).run(FIXED_UUID, '2026-08-29T00:00:00.000Z');
    db.close();
    const { client: pg, queryLog, insertCount } = makeFakePg(null);

    const result = await registerInstallation({ sqlitePath: dbPath, pg, generateId: () => OTHER_UUID });

    expect(result).toEqual({ outcome: 'completed_interrupted' });
    expect(insertCount()).toBe(1);
    // Must have inserted the EXISTING sqlite id, never the freshly generated one.
    const insert = queryLog.find((q) => /^INSERT/.test(q.text));
    expect(insert?.params[1]).toBe(FIXED_UUID);
    expect(queryLog.some((q) => /^INSERT/.test(q.text) && q.params[1] === OTHER_UUID)).toBe(false);
  });

  it('Postgres marker exists, SQLite absent: hard fails, performs zero writes, and never blesses the current SQLite file', async () => {
    const dbPath = makeDb();
    const { client: pg, insertCount } = makeFakePg({ installation_id: FIXED_UUID });

    await expect(registerInstallation({ sqlitePath: dbPath, pg })).rejects.toThrow(InstallationOrphanedPostgresError);
    expect(readSqliteInstallation(dbPath)).toBeNull();
    expect(insertCount()).toBe(0);
  });

  it('both exist but differ (mismatch): hard fails, performs zero writes, and overwrites neither marker', async () => {
    const dbPath = makeDb();
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE ${INSTALLATION_TABLE} (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO ${INSTALLATION_TABLE} VALUES ('founder-os', ?, ?)`).run(FIXED_UUID, '2026-08-29T00:00:00.000Z');
    db.close();
    const { client: pg, insertCount } = makeFakePg({ installation_id: OTHER_UUID });

    await expect(registerInstallation({ sqlitePath: dbPath, pg })).rejects.toThrow(InstallationMismatchError);

    expect(readSqliteInstallation(dbPath)?.installationId).toBe(FIXED_UUID);
    expect(insertCount()).toBe(0);
    const stored = await pg.query('SELECT installation_id FROM sqlite_installations WHERE store_name = $1', ['founder-os']);
    expect(stored.rows[0].installation_id).toBe(OTHER_UUID);
  });

  it('SQLite missing: hard fails, performs zero Postgres queries of any kind', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'installation-registration-'));
    const dbPath = path.join(tmp, 'does-not-exist.db');
    const { client: pg, queryLog } = makeFakePg();

    await expect(registerInstallation({ sqlitePath: dbPath, pg })).rejects.toThrow(InstallationSqliteUnavailableError);
    expect(queryLog).toEqual([]);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('SQLite corrupt: hard fails, performs zero Postgres queries of any kind', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'installation-registration-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    fs.writeFileSync(dbPath, 'not a real sqlite file');
    const { client: pg, queryLog } = makeFakePg();

    await expect(registerInstallation({ sqlitePath: dbPath, pg })).rejects.toThrow(InstallationSqliteUnavailableError);
    expect(queryLog).toEqual([]);
  });

  it('SQLite :memory:: hard fails, performs zero Postgres queries of any kind', async () => {
    const { client: pg, queryLog } = makeFakePg();

    await expect(registerInstallation({ sqlitePath: ':memory:', pg })).rejects.toThrow(InstallationSqliteUnavailableError);
    expect(queryLog).toEqual([]);
  });

  it('an invalid generated id performs Postgres reads only, zero INSERTs, and writes nothing to SQLite', async () => {
    const dbPath = makeDb();
    const { client: pg, selectCount, insertCount } = makeFakePg(null);

    await expect(
      registerInstallation({ sqlitePath: dbPath, pg, generateId: () => 'not-a-real-uuid' }),
    ).rejects.toThrow(InstallationMarkerInvalidError);

    // Not just "no valid row" - the metadata table itself must never have
    // been created, proving the bad id was rejected before any SQLite
    // write, and readSqliteInstallation still reports "not yet registered"
    // rather than a corrupted marker.
    expect(readSqliteInstallation(dbPath)).toBeNull();
    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((r: unknown) => (r as { name: string }).name);
    db.close();
    expect(tables).toEqual([]);

    // Postgres was read once (to check the "neither exists" precondition)
    // but never written to.
    expect(selectCount()).toBe(1);
    expect(insertCount()).toBe(0);
  });

  it('a subsequent registration attempt with a valid id still succeeds after a prior invalid-id attempt failed cleanly', async () => {
    const dbPath = makeDb();
    const { client: pg, insertCount } = makeFakePg(null);

    await expect(
      registerInstallation({ sqlitePath: dbPath, pg, generateId: () => 'garbage' }),
    ).rejects.toThrow(InstallationMarkerInvalidError);

    const result = await registerInstallation({ sqlitePath: dbPath, pg, generateId: () => FIXED_UUID });
    expect(result).toEqual({ outcome: 'registered' });
    expect(readSqliteInstallation(dbPath)?.installationId).toBe(FIXED_UUID);
    expect(insertCount()).toBe(1);
  });

  it('an existing invalid stored SQLite marker fails closed, performs zero Postgres queries, and is never overwritten', async () => {
    const dbPath = makeDb();
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE ${INSTALLATION_TABLE} (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO ${INSTALLATION_TABLE} VALUES ('founder-os', 'already-corrupt-not-a-uuid', '2026-08-29T00:00:00.000Z')`).run();
    db.close();
    const { client: pg, queryLog } = makeFakePg(null);

    await expect(registerInstallation({ sqlitePath: dbPath, pg, generateId: () => FIXED_UUID })).rejects.toThrow(
      InstallationMarkerInvalidError,
    );

    // readSqliteInstallation() throws before registerInstallation() ever
    // reaches its Postgres read - not just "zero writes", zero queries at all.
    expect(queryLog).toEqual([]);

    // The corrupt row is untouched - never silently "fixed" or overwritten.
    const verifyDb = new Database(dbPath, { readonly: true });
    const raw = verifyDb
      .prepare(`SELECT installation_id FROM ${INSTALLATION_TABLE} WHERE store_name = 'founder-os'`)
      .get() as { installation_id: string };
    verifyDb.close();
    expect(raw.installation_id).toBe('already-corrupt-not-a-uuid');
  });

  it('is idempotent: running registration twice in a row on the same fresh pair performs exactly one INSERT total', async () => {
    const dbPath = makeDb();
    const { client: pg, insertCount } = makeFakePg(null);

    const first = await registerInstallation({ sqlitePath: dbPath, pg, generateId: () => FIXED_UUID });
    const second = await registerInstallation({ sqlitePath: dbPath, pg, generateId: () => OTHER_UUID });

    expect(first).toEqual({ outcome: 'registered' });
    expect(second).toEqual({ outcome: 'already_registered' });
    expect(readSqliteInstallation(dbPath)?.installationId).toBe(FIXED_UUID);
    expect(insertCount()).toBe(1);
  });
});

describe('registerInstallation - concurrent registration (race safety)', () => {
  it('two registrars racing from the apparent neither-marker state converge on one SQLite-persisted id, never split-brain', async () => {
    const dbPath = makeDb();
    const { client: pg, queryLog, pendingCount, releaseNextSelect, releaseNextInsert, enableAutoRelease } = makeSequencedPg(null);
    const fixedNow = () => new Date('2026-08-29T00:00:00.000Z');

    // Fire both "concurrently" - each runs synchronously up to its first
    // Postgres read (SQLite is read synchronously before that), which is
    // where it blocks on the sequenced fake. This is a controlled stand-in
    // for two real processes/CLI invocations each independently observing
    // "neither marker exists" before either has written anything.
    const runA = registerInstallation({ sqlitePath: dbPath, pg, generateId: () => FIXED_UUID, now: fixedNow });
    const runB = registerInstallation({ sqlitePath: dbPath, pg, generateId: () => OTHER_UUID, now: fixedNow });

    // Both runs genuinely started from the neither-marker state: both are
    // blocked on their own initial Postgres read, and SQLite has no row yet.
    expect(pendingCount()).toBe(2);
    expect(readSqliteInstallation(dbPath)).toBeNull();

    // Let A's initial read resolve (pgId=null for A): A proceeds to write
    // SQLite (a real, synchronous file write) and then blocks on its own
    // Postgres INSERT.
    releaseNextSelect();
    await tick();
    expect(readSqliteInstallation(dbPath)?.installationId).toBe(FIXED_UUID);

    // Now let B's initial read resolve. B's own read had already returned
    // "neither" (captured before A wrote) - but B's own
    // writeSqliteInstallationIfAbsent() call now finds A's row already
    // there and MUST adopt it instead of B's own locally generated id.
    releaseNextSelect();
    await tick();
    expect(readSqliteInstallation(dbPath)?.installationId).toBe(FIXED_UUID); // still A - never overwritten by B

    // The critical assertion: B must never even attempt to insert its own
    // (wrong) generated id into Postgres, regardless of write-order timing.
    expect(queryLog.some((q) => /^INSERT/.test(q.text) && q.params[1] === OTHER_UUID)).toBe(false);

    // Drain the remaining Postgres round-trips (each run's INSERT, then its
    // re-read) in whatever order they're pending - both now propose the
    // SAME id, so order can no longer matter.
    while (pendingCount() > 0) {
      releaseNextInsert();
      await tick();
      if (pendingCount() > 0) {
        releaseNextSelect();
        await tick();
      }
    }

    const [resultA, resultB] = await Promise.all([runA, runB]);

    // The interesting race window is over - every query from here on
    // (direct inspection queries, the trailing re-run check) can resolve
    // immediately rather than needing an explicit release.
    enableAutoRelease();

    // No error, no mismatch, no partial state on either side.
    expect(resultA.outcome).toBe('registered');
    expect(resultB.outcome).toBe('registered');
    expect(readSqliteInstallation(dbPath)?.installationId).toBe(FIXED_UUID);
    const finalRow = await pg.query('SELECT installation_id FROM sqlite_installations WHERE store_name = $1', ['founder-os']);
    expect(finalRow.rows[0].installation_id).toBe(FIXED_UUID);

    // Across the entire race, Postgres only ever saw FIXED_UUID proposed -
    // never OTHER_UUID, and only one INSERT actually persisted a row.
    expect(queryLog.some((q) => /^INSERT/.test(q.text) && q.params[1] === OTHER_UUID)).toBe(false);
    expect(queryLog.filter((q) => /^INSERT/.test(q.text) && q.params[1] === FIXED_UUID).length).toBeGreaterThan(0);

    // Re-running afterward is a clean no-op - the state left behind is
    // fully consistent, not a lingering partial/mismatched marker.
    const third = await registerInstallation({ sqlitePath: dbPath, pg, generateId: () => OTHER_UUID });
    expect(third).toEqual({ outcome: 'already_registered' });
  });
});

// Real-database integration coverage - skips cleanly, same conditional
// pattern as tests/server-migrate.test.ts, when no DATABASE_URL is
// configured. Applies the migration itself (idempotent, IF NOT EXISTS) and
// exercises registerInstallation against a genuinely live
// sqlite_installations table, cleaning up only the row it inserted.
const TEST_DATABASE_URL = resolveTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('registerInstallation - real PostgreSQL', () => {
  it('registers and then reports already_registered against a live table', async () => {
    const dbPath = makeDb();
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const { applyMigrations } = await import('@/lib/server/migrate');
      await applyMigrations(client);
      await client.query(`DELETE FROM sqlite_installations WHERE store_name = 'founder-os'`);

      const first = await registerInstallation({ sqlitePath: dbPath, pg: client, generateId: () => FIXED_UUID });
      expect(first).toEqual({ outcome: 'registered' });

      const second = await registerInstallation({ sqlitePath: dbPath, pg: client });
      expect(second).toEqual({ outcome: 'already_registered' });
    } finally {
      await client.query(`DELETE FROM sqlite_installations WHERE store_name = 'founder-os'`);
      await client.end();
    }
  });
});

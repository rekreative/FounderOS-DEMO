import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { closePool } from '@/lib/server/db';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

/**
 * GET /api/ready — application/database readiness (diagnostics/monitoring
 * only; Railway's healthcheck points at /api/health, not this route). See
 * middleware.test.ts for the public-route-exception coverage; this file
 * covers the route's own 200/503 semantics, the additive `checks` object
 * (Observability Phase 1), and that its response body never carries raw
 * Postgres/SQLite error detail, path, or stack.
 */
const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('GET /api/ready — real PostgreSQL', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 200 { ok: true, checks: { postgres: "ok", sqlite: "not_required" } } when Postgres is reachable and the SQLite flag is unset', async () => {
    delete process.env.FOUNDER_OS_REQUIRE_EXISTING_DB;
    const { GET } = await import('@/app/api/ready/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, checks: { postgres: 'ok', sqlite: 'not_required', installation: 'not_required' } });
  });
});

describe('GET /api/ready — Postgres unavailable', () => {
  const originalDb = process.env.DATABASE_URL;

  beforeEach(async () => {
    // Drop any cached pool so the route's next query re-evaluates
    // DATABASE_URL fresh instead of reusing an already-open connection.
    await closePool();
    delete process.env.DATABASE_URL;
    delete process.env.FOUNDER_OS_REQUIRE_EXISTING_DB;
  });

  afterEach(async () => {
    await closePool();
    if (originalDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDb;
  });

  it('returns 503 { ok: false, checks: { postgres: "error", sqlite: "not_required" } } and never leaks the underlying error message, stack, or connection string', async () => {
    const { GET } = await import('@/app/api/ready/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ ok: false, checks: { postgres: 'error', sqlite: 'not_required', installation: 'not_required' } });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//i);
    expect(serialized).not.toContain('DATABASE_URL');
  });
});

describe('GET /api/ready — founder-os SQLite required', () => {
  const originalFlag = process.env.FOUNDER_OS_REQUIRE_EXISTING_DB;
  const originalDbPath = process.env.FOUNDER_OS_DB;
  let tmp: string | undefined;

  afterEach(() => {
    vi.doUnmock('@/lib/server/db');
    vi.resetModules();
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
    if (originalFlag === undefined) delete process.env.FOUNDER_OS_REQUIRE_EXISTING_DB;
    else process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = originalFlag;
    if (originalDbPath === undefined) delete process.env.FOUNDER_OS_DB;
    else process.env.FOUNDER_OS_DB = originalDbPath;
  });

  it('ok when Postgres and required founder-os SQLite are both available', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-route-sqlite-ok-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    new Database(dbPath).close();
    process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = 'true';
    process.env.FOUNDER_OS_DB = dbPath;

    vi.resetModules();
    vi.doMock('@/lib/server/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    const { GET } = await import('@/app/api/ready/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { postgres: 'ok', sqlite: 'ok', installation: 'not_required' } });
  });

  it('503 when required founder-os SQLite is missing, even though Postgres is ok', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-route-sqlite-missing-'));
    process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = 'true';
    process.env.FOUNDER_OS_DB = path.join(tmp, 'founder-os.db'); // never created

    vi.resetModules();
    vi.doMock('@/lib/server/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    const { GET } = await import('@/app/api/ready/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ ok: false, checks: { postgres: 'ok', sqlite: 'error', installation: 'not_required' } });
    expect(JSON.stringify(body)).not.toContain(tmp);
  });

  it('reports sqlite: "not_required" and stays ok when the flag is disabled, regardless of the DB file', async () => {
    delete process.env.FOUNDER_OS_REQUIRE_EXISTING_DB;

    vi.resetModules();
    vi.doMock('@/lib/server/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    const { GET } = await import('@/app/api/ready/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { postgres: 'ok', sqlite: 'not_required', installation: 'not_required' } });
  });
});

describe('GET /api/ready - installation marker (REKREOS Phase 2)', () => {
  const originalVerifyFlag = process.env.FOUNDER_OS_VERIFY_INSTALLATION;
  const originalRequireFlag = process.env.FOUNDER_OS_REQUIRE_EXISTING_DB;
  const originalDbPath = process.env.FOUNDER_OS_DB;
  let tmp: string | undefined;

  afterEach(() => {
    vi.doUnmock('@/lib/server/db');
    vi.resetModules();
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
    if (originalVerifyFlag === undefined) delete process.env.FOUNDER_OS_VERIFY_INSTALLATION;
    else process.env.FOUNDER_OS_VERIFY_INSTALLATION = originalVerifyFlag;
    if (originalRequireFlag === undefined) delete process.env.FOUNDER_OS_REQUIRE_EXISTING_DB;
    else process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = originalRequireFlag;
    if (originalDbPath === undefined) delete process.env.FOUNDER_OS_DB;
    else process.env.FOUNDER_OS_DB = originalDbPath;
  });

  function makeDbWithMarker(installationId: string): string {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-route-installation-'));
    const dbPath = path.join(tmp, 'founder-os.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE installation_metadata (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL, registered_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO installation_metadata VALUES ('founder-os', ?, '2026-08-29T00:00:00.000Z')`).run(installationId);
    db.close();
    return dbPath;
  }

  const FIXED_UUID = '4b6a1e3a-9c1a-4e3b-8f2a-6f2b1a2c3d4e';
  const OTHER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('ok and overall 200 when the verification flag is enabled and both markers match', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    process.env.FOUNDER_OS_VERIFY_INSTALLATION = 'true';
    process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = 'true';
    process.env.FOUNDER_OS_DB = dbPath;

    vi.resetModules();
    vi.doMock('@/lib/server/db', () => ({
      query: vi.fn(async (text: string) => {
        if (/^SELECT 1$/.test(text)) return { rows: [] };
        if (/sqlite_installations/.test(text)) return { rows: [{ installation_id: FIXED_UUID }] };
        throw new Error(`unexpected query: ${text}`);
      }),
    }));
    const { GET } = await import('@/app/api/ready/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { postgres: 'ok', sqlite: 'ok', installation: 'ok' } });
  });

  it('error and overall 503 when the markers mismatch, even though Postgres and SQLite are each individually reachable', async () => {
    const dbPath = makeDbWithMarker(FIXED_UUID);
    process.env.FOUNDER_OS_VERIFY_INSTALLATION = 'true';
    process.env.FOUNDER_OS_REQUIRE_EXISTING_DB = 'true';
    process.env.FOUNDER_OS_DB = dbPath;

    vi.resetModules();
    vi.doMock('@/lib/server/db', () => ({
      query: vi.fn(async (text: string) => {
        if (/^SELECT 1$/.test(text)) return { rows: [] };
        if (/sqlite_installations/.test(text)) return { rows: [{ installation_id: OTHER_UUID }] };
        throw new Error(`unexpected query: ${text}`);
      }),
    }));
    const { GET } = await import('@/app/api/ready/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ ok: false, checks: { postgres: 'ok', sqlite: 'ok', installation: 'error' } });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(FIXED_UUID);
    expect(serialized).not.toContain(OTHER_UUID);
    expect(serialized).not.toContain(dbPath);
  });

  it('does not affect ok when the verification flag is disabled, regardless of marker state', async () => {
    delete process.env.FOUNDER_OS_VERIFY_INSTALLATION;
    delete process.env.FOUNDER_OS_REQUIRE_EXISTING_DB;

    vi.resetModules();
    vi.doMock('@/lib/server/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
    const { GET } = await import('@/app/api/ready/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { postgres: 'ok', sqlite: 'not_required', installation: 'not_required' } });
  });
});

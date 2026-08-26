import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '@/lib/server/db';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

/**
 * GET /api/ready — application/database readiness (diagnostics/monitoring
 * only; Railway's healthcheck points at /api/health, not this route). See
 * middleware.test.ts for the public-route-exception coverage; this file
 * covers the route's own 200/503 semantics and that its response body never
 * carries raw Postgres error detail.
 */
const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('GET /api/ready — real PostgreSQL', () => {
  afterAll(async () => {
    await closePool();
  });

  it('returns 200 { ok: true } and nothing else when Postgres is reachable', async () => {
    const { GET } = await import('@/app/api/ready/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});

describe('GET /api/ready — Postgres unavailable', () => {
  const originalDb = process.env.DATABASE_URL;

  beforeEach(async () => {
    // Drop any cached pool so the route's next query re-evaluates
    // DATABASE_URL fresh instead of reusing an already-open connection.
    await closePool();
    delete process.env.DATABASE_URL;
  });

  afterEach(async () => {
    await closePool();
    if (originalDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDb;
  });

  it('returns 503 { ok: false } and never leaks the underlying error message, stack, or connection string', async () => {
    const { GET } = await import('@/app/api/ready/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ ok: false });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//i);
    expect(serialized).not.toContain('DATABASE_URL');
  });
});

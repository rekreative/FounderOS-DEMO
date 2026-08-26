import { describe, expect, it, vi } from 'vitest';

/**
 * GET /api/health — Railway's liveness probe. Pure process-liveness: no
 * DATABASE_URL access, no Postgres query, always 200. See
 * tests/ready-route.test.ts for the DB-readiness counterpart and
 * middleware.test.ts for the public-route-exception coverage.
 */
describe('GET /api/health', () => {
  it('returns 200 { ok: true } with no DATABASE_URL set at all', async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { GET } = await import('@/app/api/health/route');
      const res = await GET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
    }
  });

  it('never imports or calls the Postgres query primitive', async () => {
    vi.resetModules();
    const query = vi.fn();
    vi.doMock('@/lib/server/db', () => ({ query }));
    try {
      const { GET } = await import('@/app/api/health/route');
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(query).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('@/lib/server/db');
      vi.resetModules();
    }
  });
});

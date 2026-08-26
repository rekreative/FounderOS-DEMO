import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Unit-tests lib/server/db.ts's connection guard and transaction helper
// against a mocked `pg` — no real PostgreSQL needed, and DATABASE_URL never
// has to be a real credential here (it's a throwaway fixture string, the
// mock never dials out). Integration coverage against a real database lives
// in tests/server-migrate.test.ts, gated on DATABASE_URL being configured.
//
// Supabase TLS V1: PoolMock (the mocked `Pool` constructor itself) is what
// lets the TLS-config tests below inspect the exact object passed to
// `new Pool({...})` — including `ssl` — without needing lib/server/db.ts to
// export any extra TLS-specific helper.

// vi.mock('pg', ...) below is hoisted by vitest to above these declarations,
// so PoolMock (referenced directly in that factory's returned object, not
// just inside a deferred closure) must come from vi.hoisted() — a plain
// `const PoolMock = vi.fn(...)` here would be a TDZ error at mock-resolution
// time.
const { queryMock, releaseMock, connectMock, endMock, PoolMock } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const releaseMock = vi.fn();
  const connectMock = vi.fn(async () => ({ query: queryMock, release: releaseMock }));
  const endMock = vi.fn(async () => {});
  const PoolMock = vi.fn((..._args: unknown[]) => ({
    connect: connectMock,
    end: endMock,
  }));
  return { queryMock, releaseMock, connectMock, endMock, PoolMock };
});

vi.mock('pg', () => ({
  Pool: PoolMock,
  types: { setTypeParser: vi.fn() },
}));

import { closePool, getPool, withTransaction } from '@/lib/server/db';

describe('lib/server/db', () => {
  const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
  const ORIGINAL_SUPABASE_CA_PEM = process.env.SUPABASE_CA_PEM;

  beforeEach(async () => {
    await closePool();
    queryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockClear();
    PoolMock.mockClear();
  });

  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    if (ORIGINAL_SUPABASE_CA_PEM === undefined) delete process.env.SUPABASE_CA_PEM;
    else process.env.SUPABASE_CA_PEM = ORIGINAL_SUPABASE_CA_PEM;
  });

  it('fails cleanly, without a stack of DB noise, when DATABASE_URL is not set', () => {
    delete process.env.DATABASE_URL;
    expect(() => getPool()).toThrow(/DATABASE_URL/);
  });

  it('reuses one pool across repeated getPool() calls (the hot-reload guard)', () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    const first = getPool();
    const second = getPool();
    expect(second).toBe(first);
  });

  it('withTransaction issues BEGIN then the callback then COMMIT, and releases the client', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    queryMock.mockResolvedValue({ rows: [] });

    const result = await withTransaction(async (client) => {
      await client.query('SELECT 1');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(queryMock.mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('withTransaction rolls back, still releases, and rethrows when the callback fails', async () => {
    process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
    queryMock.mockImplementation(async (sql: string) => {
      if (sql === 'SELECT boom') throw new Error('boom');
      return { rows: [] };
    });

    await expect(
      withTransaction(async (client) => {
        await client.query('SELECT boom');
      }),
    ).rejects.toThrow('boom');

    expect(queryMock.mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'SELECT boom', 'ROLLBACK']);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  describe('TLS config (Supabase TLS V1)', () => {
    const FAKE_CA_PEM = '-----BEGIN CERTIFICATE-----\nFAKE-NOT-REAL-TEST-CA\n-----END CERTIFICATE-----';
    const FAKE_DATABASE_URL = 'postgres://postgres.test-project:test-password@aws-region.pooler.supabase.com:5432/postgres';

    function poolConfig(): Record<string, unknown> {
      expect(PoolMock).toHaveBeenCalledTimes(1);
      return PoolMock.mock.calls[0][0] as Record<string, unknown>;
    }

    it('passes ssl.ca and ssl.rejectUnauthorized=true when SUPABASE_CA_PEM is set', () => {
      process.env.DATABASE_URL = FAKE_DATABASE_URL;
      process.env.SUPABASE_CA_PEM = FAKE_CA_PEM;

      getPool();

      expect(poolConfig().ssl).toEqual({ ca: FAKE_CA_PEM, rejectUnauthorized: true });
    });

    it('omits ssl entirely when SUPABASE_CA_PEM is absent — local dev behavior unchanged', () => {
      process.env.DATABASE_URL = FAKE_DATABASE_URL;
      delete process.env.SUPABASE_CA_PEM;

      getPool();

      const config = poolConfig();
      expect('ssl' in config).toBe(false);
    });

    it('never falls back to an insecure ssl config, even for a falsy SUPABASE_CA_PEM value', () => {
      process.env.DATABASE_URL = FAKE_DATABASE_URL;
      process.env.SUPABASE_CA_PEM = '';

      getPool();

      // Empty string is falsy, so ssl is correctly omitted (same as unset) —
      // there is no code path in getSslConfig() that can ever produce
      // rejectUnauthorized: false.
      expect('ssl' in poolConfig()).toBe(false);
    });

    it('preserves existing pool sizing/timeouts and connectionString regardless of SUPABASE_CA_PEM', () => {
      process.env.DATABASE_URL = FAKE_DATABASE_URL;
      process.env.SUPABASE_CA_PEM = FAKE_CA_PEM;

      getPool();

      const config = poolConfig();
      expect(config.connectionString).toBe(FAKE_DATABASE_URL);
      expect(config.max).toBe(10);
      expect(config.idleTimeoutMillis).toBe(30_000);
      expect(config.connectionTimeoutMillis).toBe(10_000);
    });

    it('never prints DATABASE_URL or the CA PEM to console output while constructing the pool', () => {
      process.env.DATABASE_URL = FAKE_DATABASE_URL;
      process.env.SUPABASE_CA_PEM = FAKE_CA_PEM;

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        getPool();
        for (const spy of [logSpy, errorSpy, warnSpy]) {
          for (const call of spy.mock.calls) {
            const serialized = call.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
            expect(serialized).not.toContain(FAKE_CA_PEM);
            expect(serialized).not.toContain(FAKE_DATABASE_URL);
          }
        }
      } finally {
        logSpy.mockRestore();
        errorSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });
  });
});

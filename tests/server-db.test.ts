import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Unit-tests lib/server/db.ts's connection guard and transaction helper
// against a mocked `pg` — no real PostgreSQL needed, and DATABASE_URL never
// has to be a real credential here (it's a throwaway fixture string, the
// mock never dials out). Integration coverage against a real database lives
// in tests/server-migrate.test.ts, gated on DATABASE_URL being configured.

const queryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(async () => ({ query: queryMock, release: releaseMock }));
const endMock = vi.fn(async () => {});

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: connectMock,
    end: endMock,
  })),
  types: { setTypeParser: vi.fn() },
}));

import { closePool, getPool, withTransaction } from '@/lib/server/db';

describe('lib/server/db', () => {
  const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

  beforeEach(async () => {
    await closePool();
    queryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockClear();
  });

  afterEach(() => {
    if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
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
});

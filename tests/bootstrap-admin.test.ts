import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fully mocked — decision logic only, no real Supabase Auth network calls
 * and no real Postgres. Per this milestone's explicit instruction: creating
 * real Auth users in an integration test needs a safe guard against
 * accidental production execution that this repo's test infrastructure
 * doesn't have yet (a known, separately-tracked gap — not something to
 * redesign in this milestone). Mocking here, relying on manual QA against
 * REKREOS DEV for the real end-to-end path, is the explicitly preferred
 * approach.
 */

const createUser = vi.fn();
const listUsers = vi.fn();
const getProfileRole = vi.fn();
const query = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdminClient: () => ({ auth: { admin: { createUser, listUsers } } }),
}));
vi.mock('@/lib/server/profiles-repo', () => ({
  getProfileRole: (...args: unknown[]) => getProfileRole(...args),
}));
vi.mock('@/lib/server/db', () => ({
  query: (...args: unknown[]) => query(...args),
  closePool: vi.fn(),
}));

const { bootstrapAdminUser } = await import('@/lib/server/bootstrap-admin');

const EMAIL = 'operator@rekreative.com';
const PASSWORD = 'a-real-password-never-logged';
const USER_ID = 'user-abc-123';

beforeEach(() => {
  createUser.mockReset();
  listUsers.mockReset();
  getProfileRole.mockReset();
  query.mockReset();
});

describe('bootstrapAdminUser', () => {
  it('rejects a missing/empty email before calling any admin API', async () => {
    await expect(bootstrapAdminUser('', PASSWORD)).rejects.toThrow(/ADMIN_EMAIL is not set/);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only email the same way', async () => {
    await expect(bootstrapAdminUser('   ', PASSWORD)).rejects.toThrow(/ADMIN_EMAIL is not set/);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects a missing/empty password before calling any admin API', async () => {
    await expect(bootstrapAdminUser(EMAIL, '')).rejects.toThrow(/ADMIN_PASSWORD is not set/);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('CASE 1 — new user: creates the auth user with email_confirm and inserts an internal profile', async () => {
    createUser.mockResolvedValue({ data: { user: { id: USER_ID, email: EMAIL } }, error: null });
    // A genuinely fresh user_id cannot already have a profiles row (the FK
    // makes that impossible) — getProfileRole is still called defensively
    // on this path in the real implementation, so the fixture must reflect
    // what a real "no such row" lookup returns.
    getProfileRole.mockResolvedValue(null);
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await bootstrapAdminUser(EMAIL, PASSWORD);

    expect(result).toEqual({ outcome: 'CREATED', userId: USER_ID, email: EMAIL });
    expect(createUser).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD, email_confirm: true });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO profiles'), [USER_ID, 'internal']);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('CASE 2 — auth user exists, no profile row: repairs by inserting the missing profile, never re-creates the auth user', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'already exists' } });
    listUsers.mockResolvedValue({ data: { users: [{ id: USER_ID, email: EMAIL }] }, error: null });
    getProfileRole.mockResolvedValue(null);
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await bootstrapAdminUser(EMAIL, PASSWORD);

    expect(result).toEqual({ outcome: 'REPAIRED', userId: USER_ID, email: EMAIL });
    expect(listUsers).toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO profiles'), [USER_ID, 'internal']);
  });

  it('this REPAIRED path is also how a partial first-run failure (auth user created, profile insert previously failed) safely recovers on re-run', async () => {
    // Same fixture as CASE 2 — the point being proven is that "auth user
    // exists, no profile" is indistinguishable from, and safely handled the
    // same way as, a genuine first-run partial failure. No separate code
    // path exists (or is needed) for "recovery" vs. "someone else already
    // has this email in Auth with no profile" — both are the same state.
    createUser.mockResolvedValue({ data: { user: null }, error: { code: 'user_already_exists', message: 'already exists' } });
    listUsers.mockResolvedValue({ data: { users: [{ id: USER_ID, email: EMAIL }] }, error: null });
    getProfileRole.mockResolvedValue(null);
    query.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await bootstrapAdminUser(EMAIL, PASSWORD);
    expect(result.outcome).toBe('REPAIRED');
  });

  it('CASE 3 — auth user exists, profile already internal: no-op, no write at all', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'already exists' } });
    listUsers.mockResolvedValue({ data: { users: [{ id: USER_ID, email: EMAIL }] }, error: null });
    getProfileRole.mockResolvedValue('internal');

    const result = await bootstrapAdminUser(EMAIL, PASSWORD);

    expect(result).toEqual({ outcome: 'ALREADY_INTERNAL', userId: USER_ID, email: EMAIL });
    expect(query).not.toHaveBeenCalled();
  });

  it('CASE 4 — auth user exists, profile is client: REFUSES, makes no write, never promotes client to internal', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'already exists' } });
    listUsers.mockResolvedValue({ data: { users: [{ id: USER_ID, email: EMAIL }] }, error: null });
    getProfileRole.mockResolvedValue('client');

    const result = await bootstrapAdminUser(EMAIL, PASSWORD);

    expect(result).toEqual({ outcome: 'REFUSED_ROLE_CONFLICT', userId: USER_ID, email: EMAIL, existingRole: 'client' });
    expect(query).not.toHaveBeenCalled();
  });

  it('CASE 5 — auth user exists, profile role is an unrecognized value: fails closed the same way as an explicit client conflict, makes no write', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'already exists' } });
    listUsers.mockResolvedValue({ data: { users: [{ id: USER_ID, email: EMAIL }] }, error: null });
    getProfileRole.mockResolvedValue('owner'); // not a value this schema's CHECK constraint should ever allow — defensive path

    const result = await bootstrapAdminUser(EMAIL, PASSWORD);

    expect(result).toEqual({ outcome: 'REFUSED_ROLE_CONFLICT', userId: USER_ID, email: EMAIL, existingRole: 'owner' });
    expect(query).not.toHaveBeenCalled();
  });

  it('a createUser failure unrelated to "already exists" propagates rather than being treated as a conflict', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { code: 'unexpected_failure', message: 'network blip' } });

    await expect(bootstrapAdminUser(EMAIL, PASSWORD)).rejects.toMatchObject({ code: 'unexpected_failure' });
    expect(listUsers).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('seed-admin CLI run() — safe output only', () => {
  const bootstrapAdminUserMock = vi.fn();
  vi.doMock('@/lib/server/bootstrap-admin', () => ({ bootstrapAdminUser: bootstrapAdminUserMock }));

  const originalEmail = process.env.ADMIN_EMAIL;
  const originalPassword = process.env.ADMIN_PASSWORD;

  afterEach(() => {
    if (originalEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalEmail;
    if (originalPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalPassword;
    bootstrapAdminUserMock.mockReset();
  });

  it('never prints the password or a secret key across every outcome, including missing-input and refusal paths', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { run } = await import('@/scripts/seed-admin');

    // Missing input path.
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    await run();

    // Every outcome path.
    process.env.ADMIN_EMAIL = EMAIL;
    process.env.ADMIN_PASSWORD = PASSWORD;
    for (const result of [
      { outcome: 'CREATED', userId: USER_ID, email: EMAIL },
      { outcome: 'REPAIRED', userId: USER_ID, email: EMAIL },
      { outcome: 'ALREADY_INTERNAL', userId: USER_ID, email: EMAIL },
      { outcome: 'REFUSED_ROLE_CONFLICT', userId: USER_ID, email: EMAIL, existingRole: 'client' },
    ] as const) {
      bootstrapAdminUserMock.mockResolvedValueOnce(result);
      await run();
    }

    const everyLoggedString = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map(String).join('\n');

    expect(everyLoggedString).not.toContain(PASSWORD);
    expect(everyLoggedString).not.toContain('sb_secret_');
    expect(everyLoggedString).toContain(EMAIL);
    expect(everyLoggedString).toContain(USER_ID);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

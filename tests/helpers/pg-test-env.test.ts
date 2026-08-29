import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installTestDatabaseUrl, resolveTestDatabaseUrl } from './pg-test-env';

/**
 * tests/helpers/pg-test-env.ts - the gate that decides whether ANY
 * describe.runIf(Boolean(...)) real-Postgres integration block in this repo
 * is allowed to run. This exists because .env.local's DATABASE_URL was
 * confirmed byte-for-byte identical to Railway's production DATABASE_URL in
 * at least one installation - the helper must never treat DATABASE_URL
 * (process.env or .env.local) as an acceptable test-database source, only
 * an explicit TEST_DATABASE_URL. Every test below points FOUNDER_OS_ENV_LOCAL
 * at a temporary, throwaway fake file - the real .env.local is never read
 * or displayed here.
 */

const ORIGINAL_ENV = {
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  ALLOW_REMOTE_TEST_DATABASE: process.env.ALLOW_REMOTE_TEST_DATABASE,
  FOUNDER_OS_ENV_LOCAL: process.env.FOUNDER_OS_ENV_LOCAL,
} as const;

let tmpDir: string | undefined;

afterEach(() => {
  for (const key of Object.keys(ORIGINAL_ENV) as Array<keyof typeof ORIGINAL_ENV>) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

/** Points FOUNDER_OS_ENV_LOCAL at a temporary fake .env.local-shaped file
 *  with the given DATABASE_URL - NEVER the real .env.local. */
function fakeEnvLocalWithDatabaseUrl(databaseUrl: string): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-test-env-fake-'));
  fs.writeFileSync(path.join(tmpDir, '.env.local'), `DATABASE_URL=${databaseUrl}\n`);
  process.env.FOUNDER_OS_ENV_LOCAL = path.join(tmpDir, '.env.local');
}

/** Same, but the fake file has no DATABASE_URL at all - the common baseline
 *  for tests that aren't specifically exercising the .env.local check. */
function fakeEnvLocalWithoutDatabaseUrl(): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-test-env-fake-'));
  fs.writeFileSync(path.join(tmpDir, '.env.local'), 'SOME_UNRELATED_VAR=x\n');
  process.env.FOUNDER_OS_ENV_LOCAL = path.join(tmpDir, '.env.local');
}

const FAKE_APP_DATABASE_URL = 'postgresql://appuser:appsecret@db.example-not-real-production.internal:5432/founder_os_prod';
const FAKE_LOCAL_TEST_URL = 'postgres://testuser:testpass@localhost:5432/founder_os_test';
const FAKE_REMOTE_TEST_URL = 'postgres://testuser:testpass@some-remote-host.example-not-real.internal:5432/founder_os_test';

describe('resolveTestDatabaseUrl - safety gate', () => {
  it('DATABASE_URL alone (no TEST_DATABASE_URL) is ignored - returns undefined', () => {
    delete process.env.TEST_DATABASE_URL;
    process.env.DATABASE_URL = FAKE_APP_DATABASE_URL;
    fakeEnvLocalWithoutDatabaseUrl();

    expect(resolveTestDatabaseUrl()).toBeUndefined();
  });

  it('.env.local DATABASE_URL alone (no TEST_DATABASE_URL, no process.env.DATABASE_URL) is ignored - returns undefined', () => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.DATABASE_URL;
    fakeEnvLocalWithDatabaseUrl(FAKE_APP_DATABASE_URL);

    expect(resolveTestDatabaseUrl()).toBeUndefined();
  });

  it('missing TEST_DATABASE_URL with nothing else configured skips cleanly - returns undefined', () => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.DATABASE_URL;
    fakeEnvLocalWithoutDatabaseUrl();

    expect(resolveTestDatabaseUrl()).toBeUndefined();
  });

  it('a local TEST_DATABASE_URL is accepted', () => {
    process.env.TEST_DATABASE_URL = FAKE_LOCAL_TEST_URL;
    delete process.env.DATABASE_URL;
    fakeEnvLocalWithoutDatabaseUrl();

    expect(resolveTestDatabaseUrl()).toBe(FAKE_LOCAL_TEST_URL);
  });

  it('accepts 127.0.0.1 and [::1] as local hosts too', () => {
    delete process.env.DATABASE_URL;
    fakeEnvLocalWithoutDatabaseUrl();

    process.env.TEST_DATABASE_URL = 'postgres://testuser:testpass@127.0.0.1:5432/founder_os_test';
    expect(resolveTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);

    process.env.TEST_DATABASE_URL = 'postgres://testuser:testpass@[::1]:5432/founder_os_test';
    expect(resolveTestDatabaseUrl()).toBe(process.env.TEST_DATABASE_URL);
  });

  it('TEST_DATABASE_URL equal to process.env.DATABASE_URL is rejected with a fixed safe error, never echoing the URL', () => {
    process.env.TEST_DATABASE_URL = FAKE_APP_DATABASE_URL;
    process.env.DATABASE_URL = FAKE_APP_DATABASE_URL;
    fakeEnvLocalWithoutDatabaseUrl();

    let caught: Error | undefined;
    try {
      resolveTestDatabaseUrl();
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toMatch(/not safe to use/i);
    expect(caught!.message).not.toContain(FAKE_APP_DATABASE_URL);
    expect(caught!.message).not.toContain('appsecret');
    expect(caught!.message).not.toContain('db.example-not-real-production.internal');
  });

  it('TEST_DATABASE_URL equal to .env.local DATABASE_URL is rejected with the same fixed safe error', () => {
    process.env.TEST_DATABASE_URL = FAKE_APP_DATABASE_URL;
    delete process.env.DATABASE_URL;
    fakeEnvLocalWithDatabaseUrl(FAKE_APP_DATABASE_URL);

    let caught: Error | undefined;
    try {
      resolveTestDatabaseUrl();
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toMatch(/not safe to use/i);
    expect(caught!.message).not.toContain(FAKE_APP_DATABASE_URL);
    expect(caught!.message).not.toContain('appsecret');
  });

  it('a remote TEST_DATABASE_URL is rejected without the explicit opt-in', () => {
    process.env.TEST_DATABASE_URL = FAKE_REMOTE_TEST_URL;
    delete process.env.DATABASE_URL;
    delete process.env.ALLOW_REMOTE_TEST_DATABASE;
    fakeEnvLocalWithoutDatabaseUrl();

    let caught: Error | undefined;
    try {
      resolveTestDatabaseUrl();
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toMatch(/non-local host/i);
    expect(caught!.message).not.toContain(FAKE_REMOTE_TEST_URL);
    expect(caught!.message).not.toContain('some-remote-host');
  });

  it('a remote TEST_DATABASE_URL is accepted only with the explicit ALLOW_REMOTE_TEST_DATABASE=true opt-in', () => {
    process.env.TEST_DATABASE_URL = FAKE_REMOTE_TEST_URL;
    delete process.env.DATABASE_URL;
    process.env.ALLOW_REMOTE_TEST_DATABASE = 'true';
    fakeEnvLocalWithoutDatabaseUrl();

    expect(resolveTestDatabaseUrl()).toBe(FAKE_REMOTE_TEST_URL);
  });

  it('a remote TEST_DATABASE_URL is still rejected for any opt-in value other than exactly "true"', () => {
    process.env.TEST_DATABASE_URL = FAKE_REMOTE_TEST_URL;
    delete process.env.DATABASE_URL;
    process.env.ALLOW_REMOTE_TEST_DATABASE = 'yes';
    fakeEnvLocalWithoutDatabaseUrl();

    expect(() => resolveTestDatabaseUrl()).toThrow(/non-local host/i);
  });

  it('a malformed TEST_DATABASE_URL is rejected without leaking its value', () => {
    const malformed = 'not a valid url at all';
    process.env.TEST_DATABASE_URL = malformed;
    delete process.env.DATABASE_URL;
    fakeEnvLocalWithoutDatabaseUrl();

    let caught: Error | undefined;
    try {
      resolveTestDatabaseUrl();
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toMatch(/not a valid connection URL/i);
    expect(caught!.message).not.toContain(malformed);
  });

  it('a URL with no host at all is rejected as malformed', () => {
    process.env.TEST_DATABASE_URL = 'postgres://';
    delete process.env.DATABASE_URL;
    fakeEnvLocalWithoutDatabaseUrl();

    expect(() => resolveTestDatabaseUrl()).toThrow(/not a valid connection URL/i);
  });

  it('never prints TEST_DATABASE_URL, DATABASE_URL, or any credential to the console on any path', () => {
    process.env.TEST_DATABASE_URL = FAKE_APP_DATABASE_URL;
    process.env.DATABASE_URL = FAKE_APP_DATABASE_URL;
    fakeEnvLocalWithoutDatabaseUrl();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      resolveTestDatabaseUrl();
    } catch {
      // expected - asserting on console output below, not the throw itself
    }

    for (const spy of [logSpy, errorSpy, warnSpy]) expect(spy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('installTestDatabaseUrl - only assigns DATABASE_URL after every safeguard passes', () => {
  it('never mutates process.env.DATABASE_URL when TEST_DATABASE_URL matches the app URL', () => {
    process.env.TEST_DATABASE_URL = FAKE_APP_DATABASE_URL;
    process.env.DATABASE_URL = FAKE_APP_DATABASE_URL;
    fakeEnvLocalWithoutDatabaseUrl();

    expect(() => installTestDatabaseUrl()).toThrow();
    expect(process.env.DATABASE_URL).toBe(FAKE_APP_DATABASE_URL); // unchanged
  });

  it('never mutates process.env.DATABASE_URL when TEST_DATABASE_URL is a remote host without opt-in', () => {
    process.env.TEST_DATABASE_URL = FAKE_REMOTE_TEST_URL;
    process.env.DATABASE_URL = 'postgres://original-not-real/db';
    delete process.env.ALLOW_REMOTE_TEST_DATABASE;
    fakeEnvLocalWithoutDatabaseUrl();

    expect(() => installTestDatabaseUrl()).toThrow();
    expect(process.env.DATABASE_URL).toBe('postgres://original-not-real/db'); // unchanged
  });

  it('never mutates process.env.DATABASE_URL when TEST_DATABASE_URL is malformed', () => {
    process.env.TEST_DATABASE_URL = 'not a valid url';
    process.env.DATABASE_URL = 'postgres://original-not-real/db';
    fakeEnvLocalWithoutDatabaseUrl();

    expect(() => installTestDatabaseUrl()).toThrow();
    expect(process.env.DATABASE_URL).toBe('postgres://original-not-real/db'); // unchanged
  });

  it('never sets process.env.DATABASE_URL when TEST_DATABASE_URL is absent', () => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.DATABASE_URL;
    fakeEnvLocalWithoutDatabaseUrl();

    expect(installTestDatabaseUrl()).toBeUndefined();
    expect(process.env.DATABASE_URL).toBeUndefined();
  });

  it('installs a safe, accepted TEST_DATABASE_URL into process.env.DATABASE_URL and returns it', () => {
    process.env.TEST_DATABASE_URL = FAKE_LOCAL_TEST_URL;
    delete process.env.DATABASE_URL;
    fakeEnvLocalWithoutDatabaseUrl();

    const result = installTestDatabaseUrl();
    expect(result).toBe(FAKE_LOCAL_TEST_URL);
    expect(process.env.DATABASE_URL).toBe(FAKE_LOCAL_TEST_URL);
  });
});

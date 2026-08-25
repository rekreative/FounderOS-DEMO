import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Requirement 3 (FINANCES TRUTH V1) — the CSV/PDF import routes must always
 * return a real JSON body, even when the underlying store can't be opened
 * for a reason outside the caller's control. The "missing data/ directory"
 * case is now handled (lib/ledger.ts / lib/bank.ts create it on first run —
 * see tests/ledger.test.ts / tests/bank.test.ts), so these tests instead
 * poison the store path with a FILE occupying where a directory needs to be
 * created — mkdirSync itself fails there — to exercise the routes' new
 * catch-all error handling for whatever else can still go wrong.
 *
 * Each test uses a fresh env var + vi.resetModules()/dynamic import, since
 * lib/ledger.ts's/lib/bank.ts's DEFAULT_PATH is resolved once at module
 * import time from LEDGER_DB/BANK_DB.
 */

let envVarToRestore: { name: 'LEDGER_DB' | 'BANK_DB'; previous: string | undefined } | null = null;
let cleanupDir: string | null = null;

afterEach(async () => {
  if (envVarToRestore) {
    if (envVarToRestore.previous === undefined) delete process.env[envVarToRestore.name];
    else process.env[envVarToRestore.name] = envVarToRestore.previous;
    envVarToRestore = null;
  }
  if (cleanupDir) {
    fs.rmSync(cleanupDir, { recursive: true, force: true });
    cleanupDir = null;
  }
  vi.doUnmock('node:child_process');
  vi.resetModules();
});

function poisonStorePath(envVar: 'LEDGER_DB' | 'BANK_DB'): void {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-err-'));
  const blockerFile = path.join(base, 'blocker');
  fs.writeFileSync(blockerFile, 'not a directory'); // occupies where a dir is needed
  envVarToRestore = { name: envVar, previous: process.env[envVar] };
  process.env[envVar] = path.join(blockerFile, 'store.db');
  cleanupDir = base;
  vi.resetModules();
}

describe('POST /api/finances/statements — JSON error hardening', () => {
  it('[D] returns a JSON error body (not an empty/non-JSON 500) when the ledger store cannot be opened', async () => {
    poisonStorePath('LEDGER_DB');
    const { POST } = await import('@/app/api/finances/statements/route');

    const csv = 'Date,Description,Amount\n2026-08-20,Test row,-10.00\n';
    const res = await POST(
      new Request('http://x/api/finances/statements', {
        method: 'POST',
        body: csv,
        headers: { 'content-type': 'text/csv' },
      }),
    );

    expect(res.status).toBe(500);
    const data = await res.json(); // must not throw — proves a real JSON body
    expect(typeof data.error).toBe('string');
    expect(data.error.length).toBeGreaterThan(0);
    // No filesystem path leaked into the response.
    expect(data.error).not.toMatch(/[/\\]/);
  });
});

describe('POST /api/finances/bank-statement — JSON error hardening', () => {
  const FAKE_STATEMENT_TEXT = [
    'Account Ending: *7001',
    'Account Name: General Operations',
    'Statement Date: 08/01/2026',
    'Total Credits This Period $500.00',
    'Total Debits This Period $200.00',
  ].join('\n');

  it('[E] returns a JSON error body (not an empty/non-JSON 500) when the bank store cannot be opened', async () => {
    // pdftotext is an external binary this environment may not have — mock
    // node:child_process so the test exercises the openBankStore() failure
    // path deterministically, without depending on poppler being installed.
    vi.doMock('node:child_process', () => ({
      execFile: (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout: string) => void,
      ) => {
        cb(null, FAKE_STATEMENT_TEXT);
        return { stdin: { end: () => {} } };
      },
    }));
    poisonStorePath('BANK_DB');
    const { POST } = await import('@/app/api/finances/bank-statement/route');

    const res = await POST(
      new Request('http://x/api/finances/bank-statement', {
        method: 'POST',
        body: new Uint8Array([1, 2, 3]), // pdftotext is mocked — content is irrelevant
      }),
    );

    expect(res.status).toBe(500);
    const data = await res.json(); // must not throw — proves a real JSON body
    expect(typeof data.error).toBe('string');
    expect(data.error.length).toBeGreaterThan(0);
    expect(data.error).not.toMatch(/[/\\]/);
  });
});

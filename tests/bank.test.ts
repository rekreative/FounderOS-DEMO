import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openBankStore, type BankStore } from '@/lib/bank';
import type { BankSummary } from '@/lib/bank-statements';

let store: BankStore;
afterEach(() => store?.close());

const s = (account: string, business: string, month: string, c: number, d: number): BankSummary => ({
  account,
  business,
  month,
  creditsCents: c,
  debitsCents: d,
  netCents: c - d,
});

describe('bank store', () => {
  it('stores summaries and returns them ordered by month', () => {
    store = openBankStore(':memory:');
    store.upsert(s('7001', 'General Operations', '2026-04', 2130040, 1785015));
    store.upsert(s('7002', 'Vantage', '2026-04', 4000000, 1200000));
    store.upsert(s('7001', 'General Operations', '2026-03', 1800000, 1500000));
    expect(store.all()).toHaveLength(3);
    expect(store.all().map((x) => x.month)[0]).toBe('2026-03');
  });

  it('re-uploading the same account+month updates rather than duplicates', () => {
    store = openBankStore(':memory:');
    store.upsert(s('7001', 'General Operations', '2026-04', 1000, 500));
    store.upsert(s('7001', 'General Operations', '2026-04', 2130040, 1785015));
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0].creditsCents).toBe(2130040);
    expect(store.all()[0].netCents).toBe(2130040 - 1785015);
  });

  describe('openBankStore — first-run directory initialization', () => {
    it('[B] creates a missing parent directory and opens the DB successfully', () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-init-'));
      const file = path.join(base, 'nested', 'sub', 'bank.db'); // nested/sub does not exist yet
      expect(fs.existsSync(path.dirname(file))).toBe(false);
      try {
        store = openBankStore(file);
        expect(fs.existsSync(file)).toBe(true);
        store.upsert(s('7001', 'General Operations', '2026-04', 2130040, 1785015));
        expect(store.all()).toHaveLength(1);
        store.close(); // release the file handle before rmSync (Windows locks it otherwise)
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });

    it('[C] re-opening against an already-existing directory is safe and idempotent (data persists)', () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-init-'));
      const file = path.join(base, 'already-there', 'bank.db');
      try {
        store = openBankStore(file); // first open — creates the directory
        store.upsert(s('7001', 'General Operations', '2026-04', 2130040, 1785015));
        store.close();

        store = openBankStore(file); // second open — directory already exists
        expect(store.all()).toHaveLength(1); // same data, nothing lost or duplicated
        store.close(); // release the file handle before rmSync (Windows locks it otherwise)
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openLedger, type Ledger } from '@/lib/ledger';
import type { LedgerRow } from '@/lib/statements';

let led: Ledger;
afterEach(() => led?.close());

const ROWS: LedgerRow[] = [
  { date: '2026-06-01', description: 'AWS', amountCents: 5700, direction: 'out', category: 'Infrastructure' },
  { date: '2026-06-02', description: 'Facebook Ads', amountCents: 150000, direction: 'out', category: 'Advertising' },
  { date: '2026-06-03', description: 'AWS extra', amountCents: 4300, direction: 'out', category: 'Infrastructure' },
  { date: '2026-06-04', description: 'Client', amountCents: 500000, direction: 'in', category: 'Income' },
];

describe('ledger store', () => {
  it('inserts rows and dedupes re-uploads by content hash', () => {
    led = openLedger(':memory:');
    expect(led.insertRows(ROWS)).toBe(4);
    expect(led.insertRows(ROWS)).toBe(0); // same statement again → nothing new
    expect(led.rowCount()).toBe(4);
  });

  it('monthly() groups out-rows by category in USD, descending; income excluded', () => {
    led = openLedger(':memory:');
    led.insertRows(ROWS);
    expect(led.monthly()).toEqual([
      { category: 'Advertising', total: 1500 },
      { category: 'Infrastructure', total: 100 },
    ]);
  });

  it('reconcile(income) returns income, expenses (out total), and net', () => {
    led = openLedger(':memory:');
    led.insertRows(ROWS);
    expect(led.reconcile(5000)).toEqual({ income: 5000, expenses: 1600, net: 3400 });
  });

  it('monthly()/latestMonth() report only the most recent month when data spans several', () => {
    led = openLedger(':memory:');
    led.insertRows([
      { date: '2026-05-10', description: 'May AWS', amountCents: 1000, direction: 'out', category: 'Infrastructure' },
      { date: '2026-06-10', description: 'Jun Ads', amountCents: 5000, direction: 'out', category: 'Advertising' },
      { date: '2026-06-12', description: 'Jun AWS', amountCents: 2000, direction: 'out', category: 'Infrastructure' },
    ]);
    expect(led.latestMonth()).toBe('2026-06');
    expect(led.monthly()).toEqual([
      { category: 'Advertising', total: 50 },
      { category: 'Infrastructure', total: 20 }, // May's 10 excluded
    ]);
  });

  describe('monthlyFor — explicit-period query for current-month operational KPIs', () => {
    it('[A] returns spend for the exact YYYY-MM passed in', () => {
      led = openLedger(':memory:');
      led.insertRows(ROWS); // all dated 2026-06
      expect(led.monthlyFor('2026-06')).toEqual([
        { category: 'Advertising', total: 1500 },
        { category: 'Infrastructure', total: 100 },
      ]);
    });

    it('[B] old-month ledger data does not leak into a current-month query', () => {
      led = openLedger(':memory:');
      led.insertRows([
        { date: '2026-05-10', description: 'May AWS', amountCents: 1000, direction: 'out', category: 'Infrastructure' },
        { date: '2026-06-10', description: 'Jun Ads', amountCents: 5000, direction: 'out', category: 'Advertising' },
      ]);
      // The ledger's latest data is May+June, but a query for August (this
      // milestone's "current month" in the fixture data) must come back
      // empty — never silently substitute latestMonth()'s data.
      expect(led.monthlyFor('2026-08')).toEqual([]);
      // Sanity: the same store's old months are still queryable explicitly.
      expect(led.monthlyFor('2026-05')).toEqual([{ category: 'Infrastructure', total: 10 }]);
    });

    it('[C] a month with zero rows returns an empty array, not an error or a stand-in value', () => {
      led = openLedger(':memory:');
      expect(led.monthlyFor('2026-08')).toEqual([]);
    });
  });

  describe('openLedger — first-run directory initialization', () => {
    it('[A] creates a missing parent directory and opens the DB successfully', () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-init-'));
      const file = path.join(base, 'nested', 'sub', 'ledger.db'); // nested/sub does not exist yet
      expect(fs.existsSync(path.dirname(file))).toBe(false);
      try {
        led = openLedger(file);
        expect(fs.existsSync(file)).toBe(true);
        expect(led.insertRows(ROWS)).toBe(4);
        expect(led.rowCount()).toBe(4);
        led.close(); // release the file handle before rmSync (Windows locks it otherwise)
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });

    it('[C] re-opening against an already-existing directory is safe and idempotent (data persists)', () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-init-'));
      const file = path.join(base, 'already-there', 'ledger.db');
      try {
        led = openLedger(file); // first open — creates the directory
        led.insertRows(ROWS);
        led.close();

        led = openLedger(file); // second open — directory already exists
        expect(led.rowCount()).toBe(4); // same data, nothing lost or duplicated
        expect(led.insertRows(ROWS)).toBe(0); // re-inserting the same rows is still a no-op
        led.close(); // release the file handle before rmSync (Windows locks it otherwise)
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });
  });
});

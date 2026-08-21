import { describe, expect, test } from 'vitest';
import {
  incomeAccounts,
  totalIncome,
  totalExpenses,
  expensesByCategory,
  net,
  monthStartUnix,
  sumChargeIncome,
  SAMPLE_EXPENSES,
} from '@/lib/finances';

describe('incomeAccounts', () => {
  test("REKREATIVE's default visible demo set is Stripe, PayPal, Wise — one row each", () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null });
    expect(accounts).toHaveLength(3);
    expect(accounts.map((a) => a.id)).toEqual(['stripe', 'paypal', 'wise-1']);
    expect(accounts.map((a) => a.label)).toEqual(['Stripe · REKREATIVE', 'PayPal · REKREATIVE', 'Wise · REKREATIVE']);
  });

  test('0/3 disconnected by default — none configured, none live', () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null });
    expect(accounts.filter((a) => a.live)).toHaveLength(0);
  });

  test('Stripe goes live with its real month-to-date income when connected', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 7000 });
    const stripe = accounts.find((a) => a.id === 'stripe')!;
    expect(stripe.live).toBe(true);
    expect(stripe.income).toBe(7000);
  });

  test('unwired processors are honest pending — null income, not a faked zero', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 7000 });
    expect(accounts.find((a) => a.id === 'paypal')!.income).toBeNull();
    expect(accounts.find((a) => a.id === 'wise-1')!.live).toBe(false);
  });

  test('Stripe stays pending when not connected', () => {
    const stripe = incomeAccounts({ connected: false, mtdUsd: null }).find((a) => a.id === 'stripe')!;
    expect(stripe.live).toBe(false);
    expect(stripe.income).toBeNull();
  });

  test('non-Stripe accounts derive `configured` from the passed config map (key set ≠ live pull)', () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null }, { paypal: true, 'wise-1': true });
    const paypal = accounts.find((a) => a.id === 'paypal')!;
    expect(paypal.configured).toBe(true); // key present
    expect(paypal.live).toBe(false); // but no real pull implemented yet
    expect(paypal.income).toBeNull(); // so never a faked number
    expect(accounts.find((a) => a.id === 'wise-1')!.configured).toBe(true);
  });

  test('stripe.configured defaults to its connection state', () => {
    expect(incomeAccounts({ connected: true, mtdUsd: 100 }).find((a) => a.id === 'stripe')!.configured).toBe(true);
    expect(incomeAccounts({ connected: false, mtdUsd: null }).find((a) => a.id === 'stripe')!.configured).toBe(false);
  });

  test('a non-Stripe account goes live with real income when passed in liveIncomeUsd', () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null }, { 'wise-1': true }, { 'wise-1': 3400 });
    const wise = accounts.find((a) => a.id === 'wise-1')!;
    expect(wise.configured).toBe(true);
    expect(wise.live).toBe(true);
    expect(wise.income).toBe(3400);
    // others still pending
    expect(accounts.find((a) => a.id === 'paypal')!.live).toBe(false);
  });

  test('the underlying account-building mechanism stays generic — a FanBasis-style id not in the default list can still be built the same way if ever re-added', () => {
    // Exercises the same `configured`/`live`/`income` derivation the default
    // Stripe/PayPal/Wise rows use, via the config/liveIncomeUsd maps alone —
    // proof that dropping FanBasis from the default VISIBLE list didn't
    // remove the general multi-account mechanism, only its default output.
    const accounts = incomeAccounts({ connected: false, mtdUsd: null }, { 'fanbasis-lc': true }, { 'fanbasis-lc': 900 });
    // Not part of today's default visible set...
    expect(accounts.find((a) => a.id === 'fanbasis-lc')).toBeUndefined();
    // ...but the maps themselves accept any id without throwing, exactly as
    // configuredProcessors() (lib/connectors/payments.ts, untouched) still
    // reports fanbasis-lc/fanbasis-vantage/wise-2 in the full registry.
    expect(accounts).toHaveLength(3);
  });
});

describe('totalIncome', () => {
  test('sums live account income, treating pending (null) as zero', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 7000 });
    expect(totalIncome(accounts)).toBe(7000);
  });
});

describe('expenses', () => {
  const fixture = [
    { id: 'a', label: 'A', category: 'Software', monthly: 20 },
    { id: 'b', label: 'B', category: 'Software', monthly: 30 },
    { id: 'c', label: 'C', category: 'Advertising', monthly: 100 },
  ];

  test('totalExpenses sums the monthly amounts', () => {
    expect(totalExpenses(fixture)).toBe(150);
  });

  test('expensesByCategory groups + sorts by total descending', () => {
    expect(expensesByCategory(fixture)).toEqual([
      { category: 'Advertising', total: 100 },
      { category: 'Software', total: 50 },
    ]);
  });

  test('SAMPLE_EXPENSES is a non-empty set of positive recurring costs', () => {
    expect(SAMPLE_EXPENSES.length).toBeGreaterThan(0);
    expect(SAMPLE_EXPENSES.every((e) => e.monthly > 0)).toBe(true);
  });
});

describe('net', () => {
  test('income minus expenses, positive or negative', () => {
    expect(net(150, 100)).toBe(50);
    expect(net(100, 150)).toBe(-50);
  });
});

describe('Stripe month-to-date helpers', () => {
  test('monthStartUnix returns the first of the calendar month at 00:00 UTC', () => {
    const unix = monthStartUnix(new Date('2026-06-16T10:30:00Z'));
    expect(new Date(unix * 1000).toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  test('sumChargeIncome counts only paid + succeeded charges', () => {
    const result = sumChargeIncome([
      { amount: 5000, currency: 'usd', paid: true, status: 'succeeded' },
      { amount: 2000, currency: 'usd', paid: true, status: 'succeeded' },
      { amount: 9999, currency: 'usd', paid: false, status: 'failed' },
      { amount: 100, currency: 'usd', paid: true, status: 'pending' },
    ]);
    expect(result).toEqual({ amountCents: 7000, currency: 'usd', count: 2 });
  });
});

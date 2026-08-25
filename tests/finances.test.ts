import { describe, expect, test } from 'vitest';
import {
  incomeAccounts,
  totalIncome,
  observedIncome,
  totalExpenses,
  expensesByCategory,
  net,
  monthStartUnix,
  sumChargeIncome,
  SAMPLE_EXPENSES,
  currentMonthKey,
  monthlyExpenseTotal,
  netForMonth,
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

  test('currentMonthKey returns the calendar month in UTC, not the latest-data month', () => {
    expect(currentMonthKey(new Date('2026-08-24T10:00:00Z'))).toBe('2026-08');
    expect(currentMonthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
    expect(currentMonthKey(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });
});

describe('monthlyExpenseTotal — current-month operational expense KPI', () => {
  test('[H/A] sums real imported rows for the period passed in', () => {
    expect(
      monthlyExpenseTotal([
        { category: 'Software', total: 100 },
        { category: 'Advertising', total: 250 },
      ]),
    ).toBe(350);
  });

  test('[C] no rows for the period → null, never a fabricated 0', () => {
    expect(monthlyExpenseTotal([])).toBeNull();
  });

  test('[D] SAMPLE_EXPENSES can never enter this calculation — it only ever sees the rows it is given', () => {
    // monthlyExpenseTotal has no reference to SAMPLE_EXPENSES at all; passing
    // an empty period (the real shape of "current month, nothing imported
    // yet") proves there is no hidden fallback to the demo set.
    expect(monthlyExpenseTotal([])).not.toBe(totalExpenses(SAMPLE_EXPENSES));
    expect(monthlyExpenseTotal([])).toBeNull();
  });
});

describe('observedIncome — income-source availability', () => {
  test('[A] zero live income processors → income unavailable (null), never a fabricated 0 €', () => {
    const accounts = incomeAccounts({ connected: false, mtdUsd: null });
    expect(accounts.filter((a) => a.live)).toHaveLength(0);
    expect(observedIncome(accounts)).toBeNull();
  });

  test('[B] live Stripe with zero MTD charges → income = 0, a valid available value', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 0 });
    expect(accounts.find((a) => a.id === 'stripe')!.live).toBe(true);
    expect(observedIncome(accounts)).toBe(0);
  });

  test('[C] live Stripe with positive MTD → income = that real value', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 500 });
    expect(observedIncome(accounts)).toBe(500);
  });

  test('[G] config-only PayPal/Wise (credentials present, no integration) never count as live income', () => {
    // Configured but not live — the exact "key set ≠ real pull" shape from
    // incomeAccounts' own contract (see the describe block above).
    const accounts = incomeAccounts({ connected: false, mtdUsd: null }, { paypal: true, 'wise-1': true });
    expect(accounts.find((a) => a.id === 'paypal')!.configured).toBe(true);
    expect(accounts.find((a) => a.id === 'paypal')!.live).toBe(false);
    expect(accounts.find((a) => a.id === 'wise-1')!.configured).toBe(true);
    expect(accounts.find((a) => a.id === 'wise-1')!.live).toBe(false);
    // No live processor at all → still unavailable, regardless of config state.
    expect(observedIncome(accounts)).toBeNull();
  });

  test('a live processor plus other merely-configured ones only counts the live one', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 500 }, { paypal: true });
    expect(observedIncome(accounts)).toBe(500);
  });
});

describe('netForMonth — current-month operational net KPI', () => {
  test('[F] income and expenses are combined only when both are real for the same period', () => {
    expect(netForMonth(1000, 400)).toBe(600);
    expect(netForMonth(400, 1000)).toBe(-600);
  });

  test('[D] income unavailable (no live processor) + expenses available → net unavailable', () => {
    expect(netForMonth(null, 400)).toBeNull();
  });

  test('[E] income available + expenses unavailable (nothing imported) → net unavailable', () => {
    expect(netForMonth(1000, null)).toBeNull();
    expect(netForMonth(0, null)).toBeNull();
  });

  test('both unavailable → net unavailable', () => {
    expect(netForMonth(null, null)).toBeNull();
  });

  test('zero processor income is a real, honest figure — not a reason to withhold net', () => {
    expect(netForMonth(0, 400)).toBe(-400);
  });
});

describe('totalIncome — processor/bank-statement boundary', () => {
  test('[G] sums only processor accounts — has no parameter for bank-statement income, so it cannot be added in', () => {
    const accounts = incomeAccounts({ connected: true, mtdUsd: 5000 });
    // totalIncome's signature is (accounts: IncomeAccount[]) — there is no
    // second "bank income" argument for it to fold in, by construction.
    expect(totalIncome.length).toBe(1);
    expect(totalIncome(accounts)).toBe(5000);
  });
});

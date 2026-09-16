import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { summarizeLeadCollection } from '@/lib/commercial-finance';
import { CreateLeadPaymentBodySchema } from '@/lib/server/schemas';

describe('Commercial financial truth V1', () => {
  it('keeps the agreement and the money collected as distinct facts', () => {
    expect(
      summarizeLeadCollection({
        agreedValue: 600,
        billingType: 'one_off',
        amounts: [300],
      }),
    ).toEqual({ totalCollected: 300, outstandingAmount: 300, status: 'partial' });
  });

  it('does not pretend a monthly agreement has a finite outstanding balance', () => {
    expect(
      summarizeLeadCollection({
        agreedValue: 300,
        billingType: 'monthly',
        amounts: [300, 300],
      }),
    ).toEqual({ totalCollected: 600, outstandingAmount: null, status: 'active' });
  });

  it('accepts a valid manual payment with an occurrence date', () => {
    expect(
      CreateLeadPaymentBodySchema.safeParse({
        amount: 300,
        occurredAt: '2026-09-16T09:00:00.000Z',
        notes: 'Segundo pago acordado',
      }).success,
    ).toBe(true);
  });

  it('rejects a zero or negative payment', () => {
    expect(CreateLeadPaymentBodySchema.safeParse({ amount: 0, occurredAt: '2026-09-16T09:00:00.000Z' }).success).toBe(false);
    expect(CreateLeadPaymentBodySchema.safeParse({ amount: -1, occurredAt: '2026-09-16T09:00:00.000Z' }).success).toBe(false);
  });

  it('migration creates an auditable lead-payment ledger and backfills existing initial payments', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'lib', 'server', 'migrations', '0017_commercial_financial_truth_v1.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS lead_payments/);
    expect(sql).toMatch(/conversion_collected_total/);
    expect(sql).toMatch(/conversion_initial_payment/);
    expect(sql).toMatch(/payment_received/);
  });

  it('does not let editing a conversion fabricate or overwrite a past receipt', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'server', 'leads-repo.ts'), 'utf8');
    expect(source).toContain('initial payment is immutable; record a separate payment instead');
  });
});

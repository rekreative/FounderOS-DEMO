import { describe, expect, it } from 'vitest';
import { CommercialEventBodySchema } from '@/lib/server/schemas';

const identity = { leadId: 'lead-test', externalEventId: 'calendar-test|outcome', appointmentDate: '2026-10-01T10:00:00Z' };

describe('Appointment outcomes from Make', () => {
  it.each(['appointment_confirmed', 'appointment_cancelled', 'appointment_no_show'])('accepts %s with the appointment occurrence', (type) => {
    expect(CommercialEventBodySchema.safeParse({ type, ...identity }).success).toBe(true);
  });

  it.each(['appointment_confirmed', 'appointment_cancelled', 'appointment_no_show'])('requires the date for %s so old events cannot clear another booking', (type) => {
    const { appointmentDate: _date, ...noDate } = identity;
    expect(CommercialEventBodySchema.safeParse({ type, ...noDate }).success).toBe(false);
  });

  it('accepts an explicit client receipt independently from internal service terms', () => {
    expect(CommercialEventBodySchema.safeParse({ type: 'converted', leadId: 'lead-test', externalEventId: 'sale-test', conversionValue: 17.5, collectedAmount: 17.5 }).success).toBe(true);
  });

  it.each([0, -1, 21])('rejects invalid receipt amount %s', (collectedAmount) => {
    expect(CommercialEventBodySchema.safeParse({ type: 'converted', leadId: 'lead-test', externalEventId: 'sale-test', conversionValue: 20, collectedAmount }).success).toBe(false);
  });

  it('requires a conversion value with a receipt and forbids mixing two payment representations', () => {
    expect(CommercialEventBodySchema.safeParse({ type: 'converted', leadId: 'lead-test', externalEventId: 'sale-test', collectedAmount: 17.5 }).success).toBe(false);
    expect(CommercialEventBodySchema.safeParse({ type: 'converted', leadId: 'lead-test', externalEventId: 'sale-test', conversionValue: 20, collectedAmount: 20, serviceId: 'service', paymentPlan: 'full', initialPayment: 20 }).success).toBe(false);
  });

  it('preserves the old value-only conversion contract', () => {
    expect(CommercialEventBodySchema.safeParse({ type: 'converted', leadId: 'lead-test', externalEventId: 'sale-test', conversionValue: 20 }).success).toBe(true);
  });
});

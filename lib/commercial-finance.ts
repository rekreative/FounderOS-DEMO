import type { BusinessBillingType } from '@/lib/business';

export type LeadCollectionStatus = 'not_recorded' | 'partial' | 'settled' | 'active';

export type LeadCollectionSummary = {
  /** Money actually collected, never the value merely agreed with the lead. */
  totalCollected: number;
  /** Only meaningful for one-off agreements. Monthly services are open-ended. */
  outstandingAmount: number | null;
  status: LeadCollectionStatus;
};

/**
 * Pure commercial-finance projection. The agreement stays on the lead while
 * the ledger records every real receipt. Keeping this rule pure makes the
 * UI, API and future Stripe sync agree on what is and is not collected money.
 */
export function summarizeLeadCollection(input: {
  agreedValue: number | null;
  billingType: BusinessBillingType | null;
  amounts: number[];
}): LeadCollectionSummary {
  const totalCollected = input.amounts.reduce((total, amount) => total + amount, 0);

  if (input.billingType === 'monthly') {
    return {
      totalCollected,
      outstandingAmount: null,
      status: totalCollected > 0 ? 'active' : 'not_recorded',
    };
  }

  if (input.agreedValue == null || totalCollected === 0) {
    return { totalCollected, outstandingAmount: input.agreedValue, status: 'not_recorded' };
  }

  const outstandingAmount = Math.max(0, input.agreedValue - totalCollected);
  return {
    totalCollected,
    outstandingAmount,
    status: outstandingAmount === 0 ? 'settled' : 'partial',
  };
}

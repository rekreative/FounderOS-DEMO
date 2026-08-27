import type { RevenueRecord } from '@/lib/results';
import { apiFetch } from './http';

/**
 * Browser-facing HTTP client for the canonical PostgreSQL manual revenue
 * ledger (Results Manual Revenue V1, GET/POST /api/revenue-records, PATCH
 * /api/revenue-records/[id]). Replaces lib/results.ts's browser-localStorage
 * RevenueRecord CRUD (getRevenueRecords/createRevenueRecord/
 * updateRevenueRecord) — the RevenueRecord type and its pure period/trend/
 * formatting helpers (filterRevenueRecordsByPeriod, groupRevenueByPeriod,
 * sumAttributedRevenue, hasDemoRevenueRecords, getRevenueSourceLabel,
 * formatEUR, ...) still come from lib/results.ts unchanged. Never imports
 * lib/server/*.
 */

export type { RevenueRecord };

export type CreateRevenueRecordInput = {
  clientId: string;
  amount: number;
  occurredAt: string;
  notes?: string | null;
};

// clientId/amount/occurredAt/notes only — source/externalRef/dataSource stay
// system-controlled, matching the server's UpdateRevenueRecordBodySchema.
export type UpdateRevenueRecordInput = Partial<{
  clientId: string;
  amount: number;
  occurredAt: string;
  notes: string | null;
}>;

/** Unbounded per-client list, newest occurredAt first — the caller applies
 * period filtering client-side via lib/results.ts's filterRevenueRecordsByPeriod,
 * unchanged from before the cutover. */
export async function getRevenueRecords(clientId: string): Promise<RevenueRecord[]> {
  const { records } = await apiFetch<{ records: RevenueRecord[] }>(
    `/api/revenue-records?clientId=${encodeURIComponent(clientId)}`,
  );
  return records;
}

export async function createRevenueRecord(input: CreateRevenueRecordInput): Promise<RevenueRecord> {
  const { record } = await apiFetch<{ record: RevenueRecord }>('/api/revenue-records', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return record;
}

export async function updateRevenueRecord(id: string, patch: UpdateRevenueRecordInput): Promise<RevenueRecord> {
  const { record } = await apiFetch<{ record: RevenueRecord }>(`/api/revenue-records/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return record;
}

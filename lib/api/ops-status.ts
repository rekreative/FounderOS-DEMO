import type { OpsSnapshot } from '@/lib/ops-status';
import { apiFetch } from './http';

/**
 * Browser-facing HTTP client for the Real V1 operational-evidence snapshot
 * (GET /api/ops/status → lib/server/ops-status.ts). Never imports
 * lib/server/* — same boundary discipline as lib/api/results.ts.
 */
export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  return apiFetch<OpsSnapshot>('/api/ops/status');
}

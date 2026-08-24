import type { OpsClientSnapshot, OpsSnapshot } from '@/lib/ops-status';
import { apiFetch } from './http';

/**
 * Browser-facing HTTP client for the Real V1 operational-evidence snapshot
 * (GET /api/ops/status → lib/server/ops-status.ts). Never imports
 * lib/server/* — same boundary discipline as lib/api/results.ts.
 */
export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  return apiFetch<OpsSnapshot>('/api/ops/status');
}

/**
 * Client Truth Alignment V1 — the per-clients.id counterpart
 * (GET /api/ops/status/client/[clientId] → getClientOpsSnapshot). Powers
 * the Client Workspace's Automations/AI Agents tabs and Overview summaries.
 */
export async function getClientOpsSnapshot(clientId: string): Promise<OpsClientSnapshot> {
  return apiFetch<OpsClientSnapshot>(`/api/ops/status/client/${encodeURIComponent(clientId)}`);
}

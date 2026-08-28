import type { IntegrationConnection, IntegrationPlatform, IntegrationRecordStatus, IntegrationScope } from '@/lib/integration-connections';
import { apiFetch } from './http';

/**
 * Browser-facing HTTP client for the canonical PostgreSQL integration
 * connections ledger (Connections/Secrets V1, GET/POST
 * /api/integration-connections, PATCH /api/integration-connections/[id]).
 * Replaces lib/integration-connections.ts's browser-localStorage
 * IntegrationConnection CRUD — the IntegrationConnection type and its pure
 * helpers (option lists, label getters, getIntegrationConfigurationStatus,
 * summarizeIntegrationConnections) still come from lib/integration-connections.ts
 * unchanged. Never imports lib/server/*.
 *
 * Deliberately a distinct module/path from the legacy FounderOS connector
 * marketplace's read-only GET /api/connections — never the same collection.
 */

export type { IntegrationConnection };

export type CreateIntegrationConnectionInput = {
  scope: IntegrationScope;
  clientId?: string | null;
  platform: IntegrationPlatform;
  name: string;
  externalRef?: string | null;
  externalLabel?: string | null;
  notes?: string | null;
};

// Business fields only — verification state and archive state each go
// through their own dedicated wrapper below (mirroring the server's
// discriminated-union PATCH contract: one mutation family per request).
export type UpdateIntegrationConnectionInput = Partial<{
  scope: IntegrationScope;
  clientId: string | null;
  platform: IntegrationPlatform;
  name: string;
  externalRef: string | null;
  externalLabel: string | null;
  notes: string | null;
}>;

export type ListIntegrationConnectionsOptions = {
  clientId?: string;
  /** Defaults to 'active' server-side when omitted. */
  status?: IntegrationRecordStatus;
};

/** Active records by default; pass status: 'archived' for the archived view. */
export async function getIntegrationConnections(options: ListIntegrationConnectionsOptions = {}): Promise<IntegrationConnection[]> {
  const params = new URLSearchParams();
  if (options.clientId) params.set('clientId', options.clientId);
  if (options.status) params.set('status', options.status);
  const qs = params.toString();
  const { connections } = await apiFetch<{ connections: IntegrationConnection[] }>(
    `/api/integration-connections${qs ? `?${qs}` : ''}`,
  );
  return connections;
}

export async function createIntegrationConnection(input: CreateIntegrationConnectionInput): Promise<IntegrationConnection> {
  const { connection } = await apiFetch<{ connection: IntegrationConnection }>('/api/integration-connections', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return connection;
}

export async function updateIntegrationConnection(id: string, patch: UpdateIntegrationConnectionInput): Promise<IntegrationConnection> {
  const { connection } = await apiFetch<{ connection: IntegrationConnection }>(`/api/integration-connections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'edit', ...patch }),
  });
  return connection;
}

async function patchVerification(id: string, status: 'verified' | 'failed' | 'not_verified'): Promise<IntegrationConnection> {
  const { connection } = await apiFetch<{ connection: IntegrationConnection }>(`/api/integration-connections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'verify', status }),
  });
  return connection;
}

export function markIntegrationConnectionVerified(id: string): Promise<IntegrationConnection> {
  return patchVerification(id, 'verified');
}

export function markIntegrationConnectionFailed(id: string): Promise<IntegrationConnection> {
  return patchVerification(id, 'failed');
}

export function resetIntegrationConnectionVerification(id: string): Promise<IntegrationConnection> {
  return patchVerification(id, 'not_verified');
}

async function patchArchiveState(id: string, status: 'active' | 'archived'): Promise<IntegrationConnection> {
  const { connection } = await apiFetch<{ connection: IntegrationConnection }>(`/api/integration-connections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'archive', status }),
  });
  return connection;
}

export function archiveIntegrationConnection(id: string): Promise<IntegrationConnection> {
  return patchArchiveState(id, 'archived');
}

export function restoreIntegrationConnection(id: string): Promise<IntegrationConnection> {
  return patchArchiveState(id, 'active');
}

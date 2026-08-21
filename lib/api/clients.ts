import type { Client, ClientStatus } from '@/lib/clients';
import { apiFetch, nullOn404 } from './http';

/**
 * Browser-facing HTTP client for the canonical PostgreSQL Clients registry
 * (Backend V1). Reuses the `Client`/`ClientStatus` types from lib/clients.ts
 * (type-only — no runtime coupling to its localStorage implementation,
 * which stays in place as compatibility residue for the modules still out
 * of scope for this cutover). Never imports lib/server/* or anything
 * DATABASE_URL-adjacent.
 */

export type CreateClientInput = {
  name: string;
  sector: string;
  status: ClientStatus;
  service: string;
  metaBudgetMonthly: number;
  startDate: string;
  owner: string;
};

export type UpdateClientInput = Partial<CreateClientInput>;

export type DeleteClientResult =
  | { outcome: 'deleted' }
  | { outcome: 'not_found' }
  | { outcome: 'blocked'; leadCount: number };

export async function getClients(): Promise<Client[]> {
  const { clients } = await apiFetch<{ clients: Client[] }>('/api/clients');
  return clients;
}

export async function getClientById(id: string): Promise<Client | null> {
  return nullOn404(async () => {
    const { client } = await apiFetch<{ client: Client }>(`/api/clients/${encodeURIComponent(id)}`);
    return client;
  });
}

export async function createClient(input: CreateClientInput): Promise<Client> {
  const { client } = await apiFetch<{ client: Client }>('/api/clients', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return client;
}

export async function updateClient(id: string, patch: UpdateClientInput): Promise<Client | null> {
  return nullOn404(async () => {
    const { client } = await apiFetch<{ client: Client }>(`/api/clients/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return client;
  });
}

/**
 * Never throws on a 409 (blocked-by-leads) — that's an expected, structured
 * outcome the caller renders, not a failure. Mirrors
 * lib/server/clients-repo.ts's deleteClient result shape exactly.
 */
export async function deleteClient(id: string): Promise<DeleteClientResult> {
  const res = await fetch(`/api/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const body = await res.json().catch(() => null);

  if (res.status === 200) return { outcome: 'deleted' };
  if (res.status === 404) return { outcome: 'not_found' };
  if (res.status === 409) return { outcome: 'blocked', leadCount: Number(body?.leadCount ?? 0) };

  const message = typeof body?.error === 'string' ? body.error : `Request failed with status ${res.status}`;
  throw new Error(message);
}

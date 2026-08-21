import type { Client as ClientBase, ClientStatus } from '@/lib/clients';
import { query } from './db';

/**
 * Server-only PostgreSQL repository for the Clients domain (Backend V1).
 * lib/clients.ts's localStorage implementation is untouched and keeps
 * serving the modules still out of scope for this migration (Automations,
 * Agents AI, Integration Connections, Content, Knowledge, Meta Ads) — see
 * the Backend V1 architecture notes. This repo is a separate, Postgres-
 * backed source of the same Client shape, reusing the existing `Client`
 * type (plus `updatedAt`, which the localStorage model never had but the
 * DB column always has) rather than duplicating field definitions.
 */

export type ServerClient = ClientBase & { updatedAt: string };

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

type ClientRow = {
  id: string;
  name: string;
  sector: string;
  status: string;
  service: string;
  meta_budget_monthly: string;
  start_date: string;
  owner: string;
  created_at: Date;
  updated_at: Date;
};

function rowToClient(row: ClientRow): ServerClient {
  return {
    id: row.id,
    name: row.name,
    sector: row.sector,
    status: row.status as ClientStatus,
    service: row.service,
    metaBudgetMonthly: Number(row.meta_budget_monthly),
    startDate: row.start_date,
    owner: row.owner,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function generateClientId(): string {
  // Same scheme lib/clients.ts's createClient already uses — kept identical
  // so ids stay compatible in shape with existing seeded ids like
  // "client-acme" (hand-picked) or a generated "client-<base36>-<n>".
  return `client-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23503';
}

export async function listClients(): Promise<ServerClient[]> {
  const result = await query<ClientRow>('SELECT * FROM clients ORDER BY created_at DESC');
  return result.rows.map(rowToClient);
}

export async function getClientById(id: string): Promise<ServerClient | null> {
  const result = await query<ClientRow>('SELECT * FROM clients WHERE id = $1', [id]);
  return result.rowCount === 0 ? null : rowToClient(result.rows[0]);
}

export async function createClient(input: CreateClientInput): Promise<ServerClient> {
  const id = generateClientId();
  const result = await query<ClientRow>(
    `INSERT INTO clients (id, name, sector, status, service, meta_budget_monthly, start_date, owner)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, input.name.trim(), input.sector.trim(), input.status, input.service.trim(), input.metaBudgetMonthly, input.startDate, input.owner.trim()],
  );
  return rowToClient(result.rows[0]);
}

const UPDATABLE_CLIENT_FIELDS: Array<{ key: keyof UpdateClientInput; column: string }> = [
  { key: 'name', column: 'name' },
  { key: 'sector', column: 'sector' },
  { key: 'status', column: 'status' },
  { key: 'service', column: 'service' },
  { key: 'metaBudgetMonthly', column: 'meta_budget_monthly' },
  { key: 'startDate', column: 'start_date' },
  { key: 'owner', column: 'owner' },
];

export async function updateClient(id: string, patch: UpdateClientInput): Promise<ServerClient | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const { key, column } of UPDATABLE_CLIENT_FIELDS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    values.push(typeof value === 'string' ? value.trim() : value);
    setClauses.push(`${column} = $${values.length}`);
  }

  if (setClauses.length === 0) {
    return getClientById(id);
  }

  values.push(id);
  const result = await query<ClientRow>(
    `UPDATE clients SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return result.rowCount === 0 ? null : rowToClient(result.rows[0]);
}

/**
 * leads.client_id is ON DELETE RESTRICT — Postgres itself refuses the
 * delete (error 23503) when leads still reference this client. Caught here
 * and turned into a structured result (never a cascade, never nulling
 * client_id) so the route can return a clean 409 with a lead count instead
 * of leaking a raw foreign-key-violation error.
 */
export async function deleteClient(id: string): Promise<DeleteClientResult> {
  try {
    const result = await query('DELETE FROM clients WHERE id = $1', [id]);
    return result.rowCount === 0 ? { outcome: 'not_found' } : { outcome: 'deleted' };
  } catch (error) {
    if (!isForeignKeyViolation(error)) throw error;
    const countResult = await query<{ count: string }>(
      'SELECT count(*)::int AS count FROM leads WHERE client_id = $1',
      [id],
    );
    return { outcome: 'blocked', leadCount: Number(countResult.rows[0]?.count ?? 0) };
  }
}

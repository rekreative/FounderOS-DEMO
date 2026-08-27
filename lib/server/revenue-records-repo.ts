import { query } from './db';

/**
 * Server-only PostgreSQL repository for the manual revenue ledger (Results
 * Manual Revenue V1). Replaces lib/results.ts's browser-localStorage
 * RevenueRecord persistence (readStorage/writeStorage against
 * 'rek_revenue_records_v1') — the RevenueRecord *type* and its pure
 * period/trend/formatting helpers stay in lib/results.ts unchanged; this repo
 * is the new source of truth for reading/writing the rows themselves.
 *
 * A separate, secondary ledger — never merged into "Valor generado" or the
 * real ROAS/CAC calculations (lib/server/results-repo.ts). Reuses the
 * clients-repo.ts/leads-repo.ts conventions (id generation, dynamic UPDATE
 * SET clause, domain validation error mapped to 422) rather than inventing
 * new ones.
 */

export type RevenueRecordSource = 'manual' | 'stripe' | 'paypal' | 'crm';
export type RevenueRecordDataSource = 'demo' | 'manual';

export type ServerRevenueRecord = {
  id: string;
  clientId: string;
  amount: number;
  occurredAt: string;
  source: RevenueRecordSource;
  externalRef: string | null;
  notes: string | null;
  dataSource: RevenueRecordDataSource;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

/** clientId/amount/occurredAt/notes only — source/externalRef/dataSource stay
 * system-controlled (only 'manual'/'manual' is ever producible through this
 * repo in V1), and createdBy/updatedBy are always caller-supplied from the
 * authenticated user, never accepted from a request body. Same single-writer
 * discipline as lib/server/leads-repo.ts's UpdateLeadInput excluding stage. */
export type CreateRevenueRecordInput = {
  clientId: string;
  amount: number;
  occurredAt: string;
  notes?: string | null;
  createdBy: string | null;
};

export type UpdateRevenueRecordInput = Partial<{
  clientId: string;
  amount: number;
  occurredAt: string;
  notes: string | null;
}> & { updatedBy: string | null };

export class RevenueRecordValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'CLIENT_NOT_FOUND',
  ) {
    super(message);
    this.name = 'RevenueRecordValidationError';
  }
}

type RevenueRecordRow = {
  id: string;
  client_id: string;
  amount: string;
  occurred_at: Date;
  source: string;
  external_ref: string | null;
  notes: string | null;
  data_source: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

function rowToRevenueRecord(row: RevenueRecordRow): ServerRevenueRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    amount: Number(row.amount),
    occurredAt: row.occurred_at.toISOString(),
    source: row.source as RevenueRecordSource,
    externalRef: row.external_ref,
    notes: row.notes,
    dataSource: row.data_source as RevenueRecordDataSource,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function generateRevenueRecordId(): string {
  // Same scheme clients-repo.ts's generateClientId/leads-repo.ts's
  // generateLeadId already use.
  return `revenue-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}

async function assertClientExists(clientId: string): Promise<void> {
  const result = await query('SELECT 1 FROM clients WHERE id = $1', [clientId]);
  if (result.rowCount === 0) {
    throw new RevenueRecordValidationError('Cannot save a revenue record for a missing client id', 'CLIENT_NOT_FOUND');
  }
}

/** Unbounded per-client list, newest occurredAt first — mirrors
 * lib/results.ts's getRevenueRecords(clientId) exactly (full history, period
 * filtering stays a client-side concern via filterRevenueRecordsByPeriod). */
export async function listRevenueRecords(clientId: string): Promise<ServerRevenueRecord[]> {
  const result = await query<RevenueRecordRow>(
    'SELECT * FROM revenue_records WHERE client_id = $1 ORDER BY occurred_at DESC',
    [clientId],
  );
  return result.rows.map(rowToRevenueRecord);
}

export async function getRevenueRecordById(id: string): Promise<ServerRevenueRecord | null> {
  const result = await query<RevenueRecordRow>('SELECT * FROM revenue_records WHERE id = $1', [id]);
  return result.rowCount === 0 ? null : rowToRevenueRecord(result.rows[0]);
}

/** Always writes source: 'manual', externalRef: null, dataSource: 'manual' —
 * this repo has no path to producing anything else in V1, same discipline as
 * lib/results.ts's old createRevenueRecord. */
export async function createRevenueRecord(input: CreateRevenueRecordInput): Promise<ServerRevenueRecord> {
  await assertClientExists(input.clientId);

  const id = generateRevenueRecordId();
  const result = await query<RevenueRecordRow>(
    `INSERT INTO revenue_records (id, client_id, amount, occurred_at, source, external_ref, notes, data_source, created_by, updated_by)
     VALUES ($1, $2, $3, $4, 'manual', NULL, $5, 'manual', $6, $6)
     RETURNING *`,
    [id, input.clientId, input.amount, input.occurredAt, input.notes?.trim() || null, input.createdBy],
  );
  return rowToRevenueRecord(result.rows[0]);
}

const UPDATABLE_REVENUE_RECORD_FIELDS: Array<{ key: keyof UpdateRevenueRecordInput; column: string }> = [
  { key: 'clientId', column: 'client_id' },
  { key: 'amount', column: 'amount' },
  { key: 'occurredAt', column: 'occurred_at' },
  { key: 'notes', column: 'notes' },
];

export async function updateRevenueRecord(id: string, patch: UpdateRevenueRecordInput): Promise<ServerRevenueRecord | null> {
  if (patch.clientId) {
    await assertClientExists(patch.clientId);
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const { key, column } of UPDATABLE_REVENUE_RECORD_FIELDS) {
    if (!(key in patch)) continue;
    const value = patch[key as keyof typeof patch];
    values.push(key === 'notes' && typeof value === 'string' ? value.trim() || null : value);
    setClauses.push(`${column} = $${values.length}`);
  }

  values.push(patch.updatedBy);
  setClauses.push(`updated_by = $${values.length}`);

  values.push(id);
  const result = await query<RevenueRecordRow>(
    `UPDATE revenue_records SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return result.rowCount === 0 ? null : rowToRevenueRecord(result.rows[0]);
}

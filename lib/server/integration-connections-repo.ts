import { query } from './db';

/**
 * Server-only PostgreSQL repository for the canonical /connections manual
 * operational-record ledger (Connections/Secrets V1). Replaces
 * lib/integration-connections.ts's browser-localStorage IntegrationConnection
 * persistence ('rek_integration_connections_v1') — the IntegrationConnection
 * *type* and its pure helpers (option lists, label getters,
 * getIntegrationConfigurationStatus, summarizeIntegrationConnections) stay in
 * lib/integration-connections.ts unchanged; this repo is the new source of
 * truth for reading/writing the rows themselves. Reuses the
 * knowledge-entries-repo.ts scope-invariant/archive-restore shape and the
 * revenue-records-repo.ts dynamic-UPDATE/audit-field conventions rather than
 * inventing new ones.
 *
 * Deliberately unrelated to the legacy FounderOS connector marketplace
 * (lib/connectors/*, app/(internal)/integrations) — this table/repo never
 * stores or resolves a secret value.
 */

export type IntegrationConnectionScope = 'internal' | 'client';
export type IntegrationConnectionPlatform =
  | 'meta'
  | 'instagram'
  | 'whatsapp'
  | 'make'
  | 'manychat'
  | 'openai'
  | 'anthropic'
  | 'google_sheets'
  | 'google_calendar'
  | 'stripe'
  | 'paypal'
  | 'other';
export type IntegrationConnectionVerificationStatus = 'not_verified' | 'verified' | 'failed';
export type IntegrationConnectionVerificationMethod = 'manual' | 'system';
export type IntegrationConnectionDataSource = 'demo' | 'manual';
export type IntegrationConnectionRecordStatus = 'active' | 'archived';

export type ServerIntegrationConnection = {
  id: string;
  scope: IntegrationConnectionScope;
  clientId: string | null;
  platform: IntegrationConnectionPlatform;
  name: string;
  verificationStatus: IntegrationConnectionVerificationStatus;
  verificationMethod: IntegrationConnectionVerificationMethod | null;
  lastVerifiedAt: string | null;
  externalRef: string | null;
  externalLabel: string | null;
  notes: string | null;
  dataSource: IntegrationConnectionDataSource;
  status: IntegrationConnectionRecordStatus;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export class IntegrationConnectionValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'CLIENT_ID_REQUIRED' | 'CLIENT_NOT_FOUND',
  ) {
    super(message);
    this.name = 'IntegrationConnectionValidationError';
  }
}

/** scope/platform/name are required; everything else optional. dataSource,
 *  status, and every verification field are never accepted here — create
 *  always writes 'manual'/'active'/'not_verified'. createdBy comes from the
 *  authenticated caller, never the body. */
export type CreateIntegrationConnectionInput = {
  scope: IntegrationConnectionScope;
  clientId?: string | null;
  platform: IntegrationConnectionPlatform;
  name: string;
  externalRef?: string | null;
  externalLabel?: string | null;
  notes?: string | null;
  createdBy: string | null;
};

/** Business + scope fields only — dataSource, status, and every verification
 *  field stay system-controlled and are never producible through this
 *  function; see markIntegrationConnectionVerified/Failed,
 *  resetIntegrationConnectionVerification, archiveIntegrationConnection,
 *  restoreIntegrationConnection below for the only ways those change.
 *  updatedBy comes from the authenticated caller, never the body. */
export type UpdateIntegrationConnectionInput = Partial<{
  scope: IntegrationConnectionScope;
  clientId: string | null;
  platform: IntegrationConnectionPlatform;
  name: string;
  externalRef: string | null;
  externalLabel: string | null;
  notes: string | null;
}> & { updatedBy: string | null };

export type ListIntegrationConnectionsOptions = {
  /** Omitted → every connection (internal + every client), matching the
   *  current global /connections board's contract exactly. Given → that
   *  client's connections only, never internal, never another client's. */
  clientId?: string;
  /** Defaults to 'active' — archived records require an explicit
   *  status: 'archived' request. There is no 'all' option: nothing in the
   *  frontend needs an active+archived combined view, only a toggle between
   *  the two. */
  status?: IntegrationConnectionRecordStatus;
};

type IntegrationConnectionRow = {
  id: string;
  scope: string;
  client_id: string | null;
  platform: string;
  name: string;
  verification_status: string;
  verification_method: string | null;
  last_verified_at: Date | null;
  external_ref: string | null;
  external_label: string | null;
  notes: string | null;
  data_source: string;
  status: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

function rowToIntegrationConnection(row: IntegrationConnectionRow): ServerIntegrationConnection {
  return {
    id: row.id,
    scope: row.scope as IntegrationConnectionScope,
    clientId: row.client_id,
    platform: row.platform as IntegrationConnectionPlatform,
    name: row.name,
    verificationStatus: row.verification_status as IntegrationConnectionVerificationStatus,
    verificationMethod: row.verification_method as IntegrationConnectionVerificationMethod | null,
    lastVerifiedAt: row.last_verified_at ? row.last_verified_at.toISOString() : null,
    externalRef: row.external_ref,
    externalLabel: row.external_label,
    notes: row.notes,
    dataSource: row.data_source as IntegrationConnectionDataSource,
    status: row.status as IntegrationConnectionRecordStatus,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function generateIntegrationConnectionId(): string {
  // Same scheme clients-repo.ts's generateClientId/knowledge-entries-repo.ts's
  // generateKnowledgeEntryId/revenue-records-repo.ts's generateRevenueRecordId
  // use. Never accepted from the browser — always generated here.
  return `connection-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}

function nullableTrim(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The DB CHECK constraint is the ultimate backstop, but the repo validates
 * first so callers get a clean domain error (IntegrationConnectionValidationError,
 * mapped to 422 by the API layer) instead of a raw constraint-violation
 * error. Mirrors knowledge-entries-repo.ts's assertScopeInvariant exactly —
 * validates against the REAL canonical Postgres `clients` table, never the
 * legacy localStorage lib/clients.ts store lib/integration-connections.ts's
 * own assertScopeInvariant used to validate against.
 */
async function assertScopeInvariant(scope: IntegrationConnectionScope, clientId: string | null): Promise<void> {
  if (scope === 'client') {
    if (!clientId) {
      throw new IntegrationConnectionValidationError('A client-scoped integration connection requires a clientId', 'CLIENT_ID_REQUIRED');
    }
    const result = await query('SELECT 1 FROM clients WHERE id = $1', [clientId]);
    if (result.rowCount === 0) {
      throw new IntegrationConnectionValidationError('Cannot save an integration connection for a missing client id', 'CLIENT_NOT_FOUND');
    }
  }
  // scope === 'internal': clientId is force-nulled by the caller (create/update)
  // before this runs — there is nothing to reject, only to normalize.
}

/** Active records by default; archived records require an explicit
 *  status: 'archived' request. Newest-updated first, matching the current
 *  store's only-ever sort order. */
export async function listIntegrationConnections(
  options: ListIntegrationConnectionsOptions = {},
): Promise<ServerIntegrationConnection[]> {
  const status = options.status ?? 'active';
  const conditions: string[] = ['status = $1'];
  const params: unknown[] = [status];

  if (options.clientId) {
    params.push(options.clientId);
    conditions.push(`client_id = $${params.length}`);
  }

  const result = await query<IntegrationConnectionRow>(
    `SELECT * FROM integration_connections WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC`,
    params,
  );
  return result.rows.map(rowToIntegrationConnection);
}

export async function getIntegrationConnectionById(id: string): Promise<ServerIntegrationConnection | null> {
  const result = await query<IntegrationConnectionRow>('SELECT * FROM integration_connections WHERE id = $1', [id]);
  return result.rowCount === 0 ? null : rowToIntegrationConnection(result.rows[0]);
}

/** Always writes dataSource: 'manual', status: 'active',
 *  verificationStatus: 'not_verified' — this repo has no path to producing
 *  anything else, same discipline as knowledge-entries-repo.ts's
 *  createKnowledgeEntry. */
export async function createIntegrationConnection(input: CreateIntegrationConnectionInput): Promise<ServerIntegrationConnection> {
  const clientId = input.scope === 'client' ? input.clientId ?? null : null;
  await assertScopeInvariant(input.scope, clientId);

  const id = generateIntegrationConnectionId();
  const result = await query<IntegrationConnectionRow>(
    `INSERT INTO integration_connections (
       id, scope, client_id, platform, name,
       external_ref, external_label, notes,
       data_source, status, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual','active',$9,$9)
     RETURNING *`,
    [
      id,
      input.scope,
      clientId,
      input.platform,
      input.name.trim(),
      nullableTrim(input.externalRef),
      nullableTrim(input.externalLabel),
      nullableTrim(input.notes),
      input.createdBy,
    ],
  );
  return rowToIntegrationConnection(result.rows[0]);
}

const UPDATABLE_INTEGRATION_CONNECTION_FIELDS: Array<{
  key: keyof UpdateIntegrationConnectionInput;
  column: string;
  toDb: (value: unknown) => unknown;
}> = [
  { key: 'scope', column: 'scope', toDb: (v) => v },
  { key: 'platform', column: 'platform', toDb: (v) => v },
  { key: 'name', column: 'name', toDb: (v) => (v as string).trim() },
  { key: 'externalRef', column: 'external_ref', toDb: (v) => nullableTrim(v as string | null) },
  { key: 'externalLabel', column: 'external_label', toDb: (v) => nullableTrim(v as string | null) },
  { key: 'notes', column: 'notes', toDb: (v) => nullableTrim(v as string | null) },
];

/**
 * Business-field PATCH with the scope/clientId invariant enforced
 * server-side — never relies on the caller to have gotten this right. Reads
 * the current row first so a scope-only patch (or a clientId-only patch)
 * can be checked against the FINAL merged scope/clientId, not just the
 * patch in isolation — same approach knowledge-entries-repo.ts's
 * updateKnowledgeEntry uses. Switching scope to 'internal' always
 * force-nulls client_id, even if the caller's patch tried to keep one.
 * Never touches verification_status/verification_method/last_verified_at/
 * data_source/status — those have their own dedicated writers below.
 */
export async function updateIntegrationConnection(
  id: string,
  patch: UpdateIntegrationConnectionInput,
): Promise<ServerIntegrationConnection | null> {
  const current = await getIntegrationConnectionById(id);
  if (!current) return null;

  const nextScope = patch.scope ?? current.scope;
  const nextClientId =
    nextScope === 'internal' ? null : 'clientId' in patch ? patch.clientId ?? null : current.clientId;

  await assertScopeInvariant(nextScope, nextClientId);

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const { key, column, toDb } of UPDATABLE_INTEGRATION_CONNECTION_FIELDS) {
    if (!(key in patch)) continue;
    values.push(toDb(patch[key as keyof typeof patch]));
    setClauses.push(`${column} = $${values.length}`);
  }

  // client_id is always written explicitly (not just when the caller passed
  // it) — this is what actually clears it on a scope->internal transition.
  values.push(nextClientId);
  setClauses.push(`client_id = $${values.length}`);

  values.push(patch.updatedBy);
  setClauses.push(`updated_by = $${values.length}`);

  values.push(id);
  const result = await query<IntegrationConnectionRow>(
    `UPDATE integration_connections SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return result.rowCount === 0 ? null : rowToIntegrationConnection(result.rows[0]);
}

async function applyVerification(
  id: string,
  status: 'verified' | 'failed',
  updatedBy: string | null,
): Promise<ServerIntegrationConnection | null> {
  const result = await query<IntegrationConnectionRow>(
    `UPDATE integration_connections
     SET verification_status = $1, verification_method = 'manual', last_verified_at = now(),
         updated_by = $2, updated_at = now()
     WHERE id = $3
     RETURNING *`,
    [status, updatedBy, id],
  );
  return result.rowCount === 0 ? null : rowToIntegrationConnection(result.rows[0]);
}

/** The only way verificationStatus/verificationMethod/lastVerifiedAt may
 *  change to 'verified' — always method 'manual' in V1. A future real
 *  backend verifier is the only thing allowed to write method 'system'. */
export async function markIntegrationConnectionVerified(id: string, updatedBy: string | null): Promise<ServerIntegrationConnection | null> {
  return applyVerification(id, 'verified', updatedBy);
}

/** The only way to record a manually-observed problem. */
export async function markIntegrationConnectionFailed(id: string, updatedBy: string | null): Promise<ServerIntegrationConnection | null> {
  return applyVerification(id, 'failed', updatedBy);
}

/** Clears a verification claim back to the honest default. */
export async function resetIntegrationConnectionVerification(
  id: string,
  updatedBy: string | null,
): Promise<ServerIntegrationConnection | null> {
  const result = await query<IntegrationConnectionRow>(
    `UPDATE integration_connections
     SET verification_status = 'not_verified', verification_method = NULL, last_verified_at = NULL,
         updated_by = $1, updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [updatedBy, id],
  );
  return result.rowCount === 0 ? null : rowToIntegrationConnection(result.rows[0]);
}

/** No permanent delete — an operational record is meant to survive. Thin
 *  wrappers over a direct UPDATE, same convention as
 *  knowledge-entries-repo.ts's archiveKnowledgeEntry/restoreKnowledgeEntry. */
export async function archiveIntegrationConnection(id: string, updatedBy: string | null): Promise<ServerIntegrationConnection | null> {
  const result = await query<IntegrationConnectionRow>(
    `UPDATE integration_connections SET status = 'archived', updated_by = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [updatedBy, id],
  );
  return result.rowCount === 0 ? null : rowToIntegrationConnection(result.rows[0]);
}

export async function restoreIntegrationConnection(id: string, updatedBy: string | null): Promise<ServerIntegrationConnection | null> {
  const result = await query<IntegrationConnectionRow>(
    `UPDATE integration_connections SET status = 'active', updated_by = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [updatedBy, id],
  );
  return result.rowCount === 0 ? null : rowToIntegrationConnection(result.rows[0]);
}

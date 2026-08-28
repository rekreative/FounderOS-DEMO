import { query } from './db';

/**
 * Server-only PostgreSQL repository for G-Brain's structured institutional
 * knowledge (G-Brain Postgres V1). Replaces lib/knowledge-entries.ts's
 * browser-localStorage KnowledgeEntry persistence ('rek_knowledge_entries_v1')
 * — the KnowledgeEntry *type* and its pure helpers (normalizeTags,
 * searchKnowledgeEntries, summarizeKnowledgeEntries, label getters) stay in
 * lib/knowledge-entries.ts unchanged; this repo is the new source of truth
 * for reading/writing the rows themselves. Reuses the leads-repo.ts scope
 * invariant shape and the revenue-records-repo.ts dynamic-UPDATE/audit-field
 * conventions rather than inventing new ones.
 */

export type KnowledgeScope = 'internal' | 'client';
export type KnowledgeType = 'decision' | 'learning' | 'sop' | 'strategy' | 'client_context' | 'technical_note' | 'other';
export type KnowledgeSource = 'manual' | 'client' | 'campaign' | 'meeting' | 'analysis' | 'document' | 'system' | 'other';
export type KnowledgeStatus = 'active' | 'archived';
export type KnowledgeDataSource = 'demo' | 'manual';

export type ServerKnowledgeEntry = {
  id: string;
  scope: KnowledgeScope;
  clientId: string | null;
  title: string;
  type: KnowledgeType;
  tags: string[];
  summary: string;
  content: string;
  source: KnowledgeSource;
  sourceLabel: string | null;
  status: KnowledgeStatus;
  dataSource: KnowledgeDataSource;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export class KnowledgeEntryValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'CLIENT_ID_REQUIRED' | 'CLIENT_NOT_FOUND',
  ) {
    super(message);
    this.name = 'KnowledgeEntryValidationError';
  }
}

/** scope/clientId/title/type/source are required; everything else optional.
 *  dataSource is never accepted here — createKnowledgeEntry always writes
 *  'manual'. createdBy comes from the authenticated caller, never the body. */
export type CreateKnowledgeEntryInput = {
  scope: KnowledgeScope;
  clientId?: string | null;
  title: string;
  type: KnowledgeType;
  tags?: string[];
  summary?: string;
  content?: string;
  source: KnowledgeSource;
  sourceLabel?: string | null;
  status?: KnowledgeStatus;
  createdBy: string | null;
};

/** Business + scope fields only — dataSource stays system-controlled (never
 *  producible as anything but its existing value through this repo).
 *  updatedBy comes from the authenticated caller, never the body. */
export type UpdateKnowledgeEntryInput = Partial<{
  scope: KnowledgeScope;
  clientId: string | null;
  title: string;
  type: KnowledgeType;
  tags: string[];
  summary: string;
  content: string;
  source: KnowledgeSource;
  sourceLabel: string | null;
  status: KnowledgeStatus;
}> & { updatedBy: string | null };

export type ListKnowledgeEntriesOptions = {
  /** Omitted → every entry (internal + every client), matching the current
   *  global /brain board's contract exactly. Given → that client's entries
   *  only, never internal, never another client's. */
  clientId?: string;
};

type KnowledgeEntryRow = {
  id: string;
  scope: string;
  client_id: string | null;
  title: string;
  type: string;
  tags: string[];
  summary: string;
  content: string;
  source: string;
  source_label: string | null;
  status: string;
  data_source: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
};

function rowToKnowledgeEntry(row: KnowledgeEntryRow): ServerKnowledgeEntry {
  return {
    id: row.id,
    scope: row.scope as KnowledgeScope,
    clientId: row.client_id,
    title: row.title,
    type: row.type as KnowledgeType,
    tags: row.tags,
    summary: row.summary,
    content: row.content,
    source: row.source as KnowledgeSource,
    sourceLabel: row.source_label,
    status: row.status as KnowledgeStatus,
    dataSource: row.data_source as KnowledgeDataSource,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function generateKnowledgeEntryId(): string {
  // Same scheme clients-repo.ts's generateClientId/leads-repo.ts's
  // generateLeadId/revenue-records-repo.ts's generateRevenueRecordId use.
  return `knowledge-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
}

function nullableTrim(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Trim, drop empties, dedupe case-insensitively while keeping the first
 *  casing seen — identical contract to lib/knowledge-entries.ts's
 *  normalizeTags (kept independent here since this repo must not import
 *  browser-facing code). */
function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * The DB CHECK constraint is the ultimate backstop, but the repo validates
 * first so callers get a clean domain error (KnowledgeEntryValidationError,
 * mapped to 422 by the API layer) instead of a raw constraint-violation
 * error. Mirrors leads-repo.ts's assertScopeInvariant exactly.
 */
async function assertScopeInvariant(scope: KnowledgeScope, clientId: string | null): Promise<void> {
  if (scope === 'client') {
    if (!clientId) throw new KnowledgeEntryValidationError('A client-scoped knowledge entry requires a clientId', 'CLIENT_ID_REQUIRED');
    const result = await query('SELECT 1 FROM clients WHERE id = $1', [clientId]);
    if (result.rowCount === 0) throw new KnowledgeEntryValidationError('Cannot save a knowledge entry for a missing client id', 'CLIENT_NOT_FOUND');
  }
  // scope === 'internal': clientId is force-nulled by the caller (create/update)
  // before this runs — there is nothing to reject, only to normalize.
}

export async function listKnowledgeEntries(options: ListKnowledgeEntriesOptions = {}): Promise<ServerKnowledgeEntry[]> {
  if (options.clientId) {
    const result = await query<KnowledgeEntryRow>(
      'SELECT * FROM knowledge_entries WHERE client_id = $1 ORDER BY updated_at DESC',
      [options.clientId],
    );
    return result.rows.map(rowToKnowledgeEntry);
  }
  const result = await query<KnowledgeEntryRow>('SELECT * FROM knowledge_entries ORDER BY updated_at DESC');
  return result.rows.map(rowToKnowledgeEntry);
}

export async function getKnowledgeEntryById(id: string): Promise<ServerKnowledgeEntry | null> {
  const result = await query<KnowledgeEntryRow>('SELECT * FROM knowledge_entries WHERE id = $1', [id]);
  return result.rowCount === 0 ? null : rowToKnowledgeEntry(result.rows[0]);
}

/** Always writes dataSource: 'manual' — this repo has no path to producing
 *  anything else, same discipline as revenue-records-repo.ts's createRevenueRecord. */
export async function createKnowledgeEntry(input: CreateKnowledgeEntryInput): Promise<ServerKnowledgeEntry> {
  const clientId = input.scope === 'client' ? input.clientId ?? null : null;
  await assertScopeInvariant(input.scope, clientId);

  const id = generateKnowledgeEntryId();
  const result = await query<KnowledgeEntryRow>(
    `INSERT INTO knowledge_entries (
       id, scope, client_id, title, type, tags, summary, content,
       source, source_label, status, data_source, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual',$12,$12)
     RETURNING *`,
    [
      id,
      input.scope,
      clientId,
      input.title.trim(),
      input.type,
      normalizeTags(input.tags),
      input.summary?.trim() || '',
      input.content?.trim() || '',
      input.source,
      nullableTrim(input.sourceLabel),
      input.status ?? 'active',
      input.createdBy,
    ],
  );
  return rowToKnowledgeEntry(result.rows[0]);
}

const UPDATABLE_KNOWLEDGE_ENTRY_FIELDS: Array<{ key: keyof UpdateKnowledgeEntryInput; column: string; toDb: (value: unknown) => unknown }> = [
  { key: 'scope', column: 'scope', toDb: (v) => v },
  { key: 'title', column: 'title', toDb: (v) => (v as string).trim() },
  { key: 'type', column: 'type', toDb: (v) => v },
  { key: 'tags', column: 'tags', toDb: (v) => normalizeTags(v as string[]) },
  { key: 'summary', column: 'summary', toDb: (v) => (v as string) ?? '' },
  { key: 'content', column: 'content', toDb: (v) => (v as string) ?? '' },
  { key: 'source', column: 'source', toDb: (v) => v },
  { key: 'sourceLabel', column: 'source_label', toDb: (v) => nullableTrim(v as string | null) },
  { key: 'status', column: 'status', toDb: (v) => v },
];

/**
 * Business-field PATCH with the scope/clientId invariant enforced
 * server-side — never relies on the frontend to have gotten this right.
 * Reads the current row first so a scope-only patch (or a clientId-only
 * patch) can be checked against the FINAL merged scope/clientId, not just
 * the patch in isolation — same approach lib/knowledge-entries.ts's old
 * localStorage updateKnowledgeEntry used (merge, then validate the merged
 * result). Switching scope to 'internal' always force-nulls client_id,
 * even if the caller's patch tried to keep one.
 */
export async function updateKnowledgeEntry(id: string, patch: UpdateKnowledgeEntryInput): Promise<ServerKnowledgeEntry | null> {
  const current = await getKnowledgeEntryById(id);
  if (!current) return null;

  const nextScope = patch.scope ?? current.scope;
  const nextClientId =
    nextScope === 'internal'
      ? null
      : 'clientId' in patch
        ? patch.clientId ?? null
        : current.clientId;

  await assertScopeInvariant(nextScope, nextClientId);

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const { key, column, toDb } of UPDATABLE_KNOWLEDGE_ENTRY_FIELDS) {
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
  const result = await query<KnowledgeEntryRow>(
    `UPDATE knowledge_entries SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return result.rowCount === 0 ? null : rowToKnowledgeEntry(result.rows[0]);
}

/** No permanent delete — knowledge is meant to survive. Thin wrappers over
 *  updateKnowledgeEntry, same convention as the old localStorage archive/restore. */
export async function archiveKnowledgeEntry(id: string, updatedBy: string | null): Promise<ServerKnowledgeEntry | null> {
  return updateKnowledgeEntry(id, { status: 'archived', updatedBy });
}

export async function restoreKnowledgeEntry(id: string, updatedBy: string | null): Promise<ServerKnowledgeEntry | null> {
  return updateKnowledgeEntry(id, { status: 'active', updatedBy });
}

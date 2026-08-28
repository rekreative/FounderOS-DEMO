import type { KnowledgeEntry, KnowledgeScope, KnowledgeSource, KnowledgeStatus, KnowledgeType } from '@/lib/knowledge-entries';
import { apiFetch } from './http';

/**
 * Browser-facing HTTP client for the canonical PostgreSQL G-Brain knowledge
 * store (G-Brain Postgres V1, GET/POST /api/knowledge-entries, PATCH
 * /api/knowledge-entries/[id]). Replaces lib/knowledge-entries.ts's
 * browser-localStorage KnowledgeEntry CRUD — the KnowledgeEntry type and its
 * pure helpers (normalizeTags, searchKnowledgeEntries, summarizeKnowledgeEntries,
 * label getters) still come from lib/knowledge-entries.ts unchanged. Never
 * imports lib/server/*.
 */

export type { KnowledgeEntry };

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
};

// Same field set as create, all optional, plus status (archive/restore go
// through this) — dataSource/createdBy/updatedBy stay system-controlled.
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
}>;

/** clientId omitted → every entry (internal + every client) — the global
 *  /brain board's contract. clientId given → that client's entries only. */
export async function getKnowledgeEntries(clientId?: string): Promise<KnowledgeEntry[]> {
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  const { entries } = await apiFetch<{ entries: KnowledgeEntry[] }>(`/api/knowledge-entries${query}`);
  return entries;
}

export async function createKnowledgeEntry(input: CreateKnowledgeEntryInput): Promise<KnowledgeEntry> {
  const { entry } = await apiFetch<{ entry: KnowledgeEntry }>('/api/knowledge-entries', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return entry;
}

export async function updateKnowledgeEntry(id: string, patch: UpdateKnowledgeEntryInput): Promise<KnowledgeEntry> {
  const { entry } = await apiFetch<{ entry: KnowledgeEntry }>(`/api/knowledge-entries/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return entry;
}

export async function archiveKnowledgeEntry(id: string): Promise<KnowledgeEntry> {
  return updateKnowledgeEntry(id, { status: 'archived' });
}

export async function restoreKnowledgeEntry(id: string): Promise<KnowledgeEntry> {
  return updateKnowledgeEntry(id, { status: 'active' });
}

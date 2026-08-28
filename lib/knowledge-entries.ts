import { getClients } from '@/lib/clients';

// G-Brain V1 — REKREATIVE's structured institutional memory: decisions,
// learnings, SOPs, strategy, and client context, kept as typed searchable
// records. Deliberately separate from the legacy FounderOS G-Brain
// (lib/brain*.ts, lib/connectors/gbrain.ts, lib/knowledge-graph.ts,
// lib/memory-core.ts) — that system stays untouched, shells out to a real
// gbrain CLI + markdown brain-store, and now lives at /brain/legacy. This
// module owns none of that.
//
// G-Brain Postgres V1: persistence lives in lib/server/knowledge-entries-repo.ts
// (server) and lib/api/knowledge-entries.ts (browser), reached over
// GET/POST /api/knowledge-entries and PATCH /api/knowledge-entries/[id].
// This module keeps only the KnowledgeEntry type, its controlled
// enums/labels, and pure/presentational helpers shared by both the API
// layer and the components — nothing here reads or writes localStorage
// anymore.
//
// Also deliberately separate from Client Notes (lib/clients.ts's
// getClientNotes/updateClientNotes) — that's a single scratchpad string per
// client, this is structured/typed/tagged/searchable memory. No migration
// between the two exists.

export const KNOWLEDGE_SCOPE_OPTIONS = [
  { id: 'client', label: 'Cliente' },
  { id: 'internal', label: 'Interno · REKREATIVE' },
] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPE_OPTIONS)[number]['id'];

// Only two states — G-Brain is memory, not a task workflow. No draft/review.
export const KNOWLEDGE_STATUS_OPTIONS = [
  { id: 'active', label: 'Activo' },
  { id: 'archived', label: 'Archivado' },
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUS_OPTIONS)[number]['id'];

// The controlled taxonomy — deliberately small and non-overlapping so a
// human actually picks the right one instead of guessing between near
// synonyms. Free tags (see normalizeTags) cover everything this can't.
export const KNOWLEDGE_TYPE_OPTIONS = [
  { id: 'decision', label: 'Decisión' },
  { id: 'learning', label: 'Aprendizaje' },
  { id: 'sop', label: 'SOP' },
  { id: 'strategy', label: 'Estrategia' },
  { id: 'client_context', label: 'Contexto de cliente' },
  { id: 'technical_note', label: 'Nota técnica' },
  { id: 'other', label: 'Otro' },
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPE_OPTIONS)[number]['id'];

// Provenance only — describes what the knowledge is *about*, never implies
// automatic ingestion. Every entry is manually authored regardless of which
// source it names; 'system' is reserved, unused by any manual entry, for a
// future real integration.
export const KNOWLEDGE_SOURCE_OPTIONS = [
  { id: 'manual', label: 'Manual' },
  { id: 'client', label: 'Cliente' },
  { id: 'campaign', label: 'Campaña' },
  { id: 'meeting', label: 'Reunión' },
  { id: 'analysis', label: 'Análisis' },
  { id: 'document', label: 'Documento' },
  { id: 'system', label: 'Sistema' },
  { id: 'other', label: 'Otro' },
] as const;
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCE_OPTIONS)[number]['id'];

/** 'demo' = seeded placeholder data, 'manual' = entered by hand in this UI.
 * No automatic ingestion exists, so nothing else is ever stamped here. */
export type KnowledgeDataSource = 'demo' | 'manual';

export type KnowledgeEntry = {
  id: string;

  scope: KnowledgeScope;
  /** Required when scope === 'client'; always null when scope === 'internal'. */
  clientId: string | null;

  title: string;
  type: KnowledgeType;
  /** Free tags — flexible context. KnowledgeType is the controlled taxonomy;
   * there is no second category field. */
  tags: string[];

  summary: string;
  content: string;

  source: KnowledgeSource;
  /** Optional human-readable provenance detail, e.g. "Reunión Acme —
   * 12/08/2026". Never implies automatic capture of that meeting/document. */
  sourceLabel: string | null;

  status: KnowledgeStatus;

  createdAt: string;
  updatedAt: string;

  dataSource: KnowledgeDataSource;
};

/** Trim, drop empties, dedupe case-insensitively while keeping the first
 * casing seen — "Meta Ads" and "meta ads" collapse to one tag. */
export function normalizeTags(tags: string[] | undefined | null): string[] {
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

// ===== SEARCH (client-side, no fuzzy matching, no embeddings) =====

/** Case-insensitive substring match across title, summary, content, and
 * tags. An empty/blank query returns every entry unfiltered. */
export function searchKnowledgeEntries(entries: KnowledgeEntry[], query: string): KnowledgeEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((entry) => {
    if (entry.title.toLowerCase().includes(q)) return true;
    if (entry.summary.toLowerCase().includes(q)) return true;
    if (entry.content.toLowerCase().includes(q)) return true;
    if (entry.tags.some((tag) => tag.toLowerCase().includes(q))) return true;
    return false;
  });
}

// ===== DERIVED (never persisted) =====

export type KnowledgeEntriesSummary = {
  /** Active entries only — archived never counts toward any of these. */
  activeTotal: number;
  internal: number;
  client: number;
  /** Distinct clients with at least one active client-scoped entry. */
  clientsWithKnowledge: number;
  /** Active entries updated in the last 7 days. */
  recentlyUpdated: number;
};

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Aggregate KPI totals over a set of entries — callers recompute from
 * whatever set is currently filtered, same convention as
 * summarizeContentItems/summarizeAiAgents. Only honest, cheaply-derived
 * counts — never a quality/confidence/usefulness score. */
export function summarizeKnowledgeEntries(entries: KnowledgeEntry[]): KnowledgeEntriesSummary {
  const active = entries.filter((entry) => entry.status === 'active');
  const now = Date.now();
  const clientIds = new Set(
    active.filter((entry) => entry.scope === 'client' && entry.clientId).map((entry) => entry.clientId as string),
  );
  return {
    activeTotal: active.length,
    internal: active.filter((entry) => entry.scope === 'internal').length,
    client: active.filter((entry) => entry.scope === 'client').length,
    clientsWithKnowledge: clientIds.size,
    recentlyUpdated: active.filter((entry) => now - new Date(entry.updatedAt).getTime() <= RECENT_WINDOW_MS).length,
  };
}

// ===== LABELS =====

/** "REKREATIVE" alone for internal entries — not "Interno · REKREATIVE",
 * which reads redundantly once this label is combined with a source/type
 * label at the call site (e.g. "REKREATIVE · Análisis"). Client entries keep
 * their name plain, same as before. Presentation only — scope/clientId
 * themselves are untouched. */
export function getClientNameForKnowledgeEntry(
  clientId: string | null,
  clients: { id: string; name: string }[] = getClients(),
): string {
  if (!clientId) return 'REKREATIVE';
  const client = clients.find((item) => item.id === clientId);
  return client?.name ?? 'Cliente desconocido';
}

export function getKnowledgeScopeLabel(scope: KnowledgeScope): string {
  return KNOWLEDGE_SCOPE_OPTIONS.find((option) => option.id === scope)?.label ?? scope;
}

export function getKnowledgeStatusLabel(status: KnowledgeStatus): string {
  return KNOWLEDGE_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}

export function getKnowledgeTypeLabel(type: KnowledgeType): string {
  return KNOWLEDGE_TYPE_OPTIONS.find((option) => option.id === type)?.label ?? type;
}

export function getKnowledgeSourceLabel(source: KnowledgeSource): string {
  return KNOWLEDGE_SOURCE_OPTIONS.find((option) => option.id === source)?.label ?? source;
}

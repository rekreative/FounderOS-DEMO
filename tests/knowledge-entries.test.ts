import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStoreIfNeeded as initializeClientsStoreIfNeeded } from '@/lib/clients';
import {
  KNOWLEDGE_SCOPE_OPTIONS,
  KNOWLEDGE_SOURCE_OPTIONS,
  KNOWLEDGE_STATUS_OPTIONS,
  KNOWLEDGE_TYPE_OPTIONS,
  getClientNameForKnowledgeEntry,
  getKnowledgeScopeLabel,
  getKnowledgeSourceLabel,
  getKnowledgeStatusLabel,
  getKnowledgeTypeLabel,
  normalizeTags,
  searchKnowledgeEntries,
  summarizeKnowledgeEntries,
  type KnowledgeEntry,
} from '@/lib/knowledge-entries';

// G-Brain Postgres V1: the persistence layer (CRUD, scope invariant,
// localStorage read/write) moved to lib/server/knowledge-entries-repo.ts —
// see tests/knowledge-entries-repo.test.ts and tests/api-knowledge-entries.test.ts
// for that coverage. This file only exercises what's left in
// lib/knowledge-entries.ts: the KnowledgeEntry type, its controlled enums,
// and pure/presentational helpers shared by both the API layer and the
// components.

// Same in-memory localStorage stand-in as tests/content-items.test.ts and
// tests/clients.test.ts — this suite runs under vitest's `node` environment
// (no window/localStorage by default). Only used below by
// getClientNameForKnowledgeEntry's default-arg test, which still reads
// lib/clients.ts's own (unrelated, still-localStorage) client registry.

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

function installBrowserLikeStorage() {
  const storage = new MemoryStorage();
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
  (globalThis as unknown as { localStorage: unknown }).localStorage = storage;
}

function uninstallBrowserLikeStorage() {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
}

describe('label helpers', () => {
  it('resolve known ids to human labels', () => {
    expect(getKnowledgeScopeLabel('client')).toBe('Cliente');
    expect(getKnowledgeScopeLabel('internal')).toBe('Interno · REKREATIVE');
    expect(getKnowledgeStatusLabel('active')).toBe('Activo');
    expect(getKnowledgeStatusLabel('archived')).toBe('Archivado');
    expect(getKnowledgeTypeLabel('sop')).toBe('SOP');
    expect(getKnowledgeTypeLabel('client_context')).toBe('Contexto de cliente');
    expect(getKnowledgeSourceLabel('meeting')).toBe('Reunión');
  });

  it('falls back to the raw id for an unrecognized value rather than throwing', () => {
    expect(getKnowledgeTypeLabel('made_up' as never)).toBe('made_up');
  });
});

describe('controlled enums', () => {
  it('scope is exactly client/internal', () => {
    expect(KNOWLEDGE_SCOPE_OPTIONS.map((o) => o.id)).toEqual(['client', 'internal']);
  });

  it('status is exactly active/archived — no workflow states', () => {
    expect(KNOWLEDGE_STATUS_OPTIONS.map((o) => o.id)).toEqual(['active', 'archived']);
  });

  it('type is the 7-value controlled taxonomy', () => {
    expect(KNOWLEDGE_TYPE_OPTIONS.map((o) => o.id)).toEqual([
      'decision',
      'learning',
      'sop',
      'strategy',
      'client_context',
      'technical_note',
      'other',
    ]);
  });

  it('source is the 8-value provenance taxonomy, including reserved "system"', () => {
    expect(KNOWLEDGE_SOURCE_OPTIONS.map((o) => o.id)).toEqual([
      'manual',
      'client',
      'campaign',
      'meeting',
      'analysis',
      'document',
      'system',
      'other',
    ]);
  });
});

describe('normalizeTags', () => {
  it('trims whitespace, drops empties, and dedupes case-insensitively keeping first casing', () => {
    expect(normalizeTags(['  Meta Ads ', 'meta ads', '', '   ', 'Leads', 'leads'])).toEqual(['Meta Ads', 'Leads']);
  });

  it('returns an empty array for undefined/null input', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
  });
});

describe('searchKnowledgeEntries', () => {
  const entries: KnowledgeEntry[] = [
    {
      id: 'k-1',
      scope: 'internal',
      clientId: null,
      title: 'Meta Ads qualification framework',
      type: 'strategy',
      tags: ['leads', 'framework'],
      summary: 'How we prioritize inbound leads',
      content: 'Budget, timeline, decision maker.',
      source: 'analysis',
      sourceLabel: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      dataSource: 'demo',
    },
    {
      id: 'k-2',
      scope: 'internal',
      clientId: null,
      title: 'Onboarding checklist',
      type: 'sop',
      tags: ['onboarding'],
      summary: 'Steps for a new client',
      content: 'Kickoff call, access, brand assets.',
      source: 'manual',
      sourceLabel: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      dataSource: 'demo',
    },
  ];

  it('matches by title, case-insensitively', () => {
    expect(searchKnowledgeEntries(entries, 'meta ads').map((e) => e.id)).toEqual(['k-1']);
    expect(searchKnowledgeEntries(entries, 'META ADS').map((e) => e.id)).toEqual(['k-1']);
  });

  it('matches by content', () => {
    expect(searchKnowledgeEntries(entries, 'kickoff').map((e) => e.id)).toEqual(['k-2']);
  });

  it('matches by tags', () => {
    expect(searchKnowledgeEntries(entries, 'framework').map((e) => e.id)).toEqual(['k-1']);
  });

  it('matches by summary', () => {
    expect(searchKnowledgeEntries(entries, 'inbound').map((e) => e.id)).toEqual(['k-1']);
  });

  it('returns every entry for a blank query', () => {
    expect(searchKnowledgeEntries(entries, '   ')).toHaveLength(2);
  });

  it('returns nothing for a query that matches no entry', () => {
    expect(searchKnowledgeEntries(entries, 'nonexistent-term-xyz')).toEqual([]);
  });
});

describe('summarizeKnowledgeEntries', () => {
  const base = {
    tags: [] as string[],
    summary: '',
    content: '',
    source: 'manual' as const,
    sourceLabel: null,
    dataSource: 'demo' as const,
  };

  it('counts active internal/client entries and excludes archived from every count', () => {
    const now = new Date();
    const recent = now.toISOString();
    const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const entries: KnowledgeEntry[] = [
      { id: '1', scope: 'internal', clientId: null, title: 'A', type: 'sop', status: 'active', createdAt: old, updatedAt: recent, ...base },
      { id: '2', scope: 'client', clientId: 'client-acme', title: 'B', type: 'decision', status: 'active', createdAt: old, updatedAt: recent, ...base },
      { id: '3', scope: 'client', clientId: 'client-northwind', title: 'C', type: 'learning', status: 'active', createdAt: old, updatedAt: old, ...base },
      { id: '4', scope: 'client', clientId: 'client-acme', title: 'D', type: 'learning', status: 'active', createdAt: old, updatedAt: old, ...base },
      { id: '5', scope: 'internal', clientId: null, title: 'E', type: 'decision', status: 'archived', createdAt: old, updatedAt: recent, ...base },
    ];

    const summary = summarizeKnowledgeEntries(entries);
    expect(summary.activeTotal).toBe(4); // excludes the archived one
    expect(summary.internal).toBe(1);
    expect(summary.client).toBe(3);
    expect(summary.clientsWithKnowledge).toBe(2); // acme + northwind, deduped
    expect(summary.recentlyUpdated).toBe(2); // entries 1 and 2 only
  });
});

describe('getClientNameForKnowledgeEntry', () => {
  beforeEach(() => {
    installBrowserLikeStorage();
    initializeClientsStoreIfNeeded();
  });

  afterEach(() => {
    uninstallBrowserLikeStorage();
  });

  it('resolves a real client name and labels internal/unknown honestly (default arg, lib/clients.ts registry)', () => {
    expect(getClientNameForKnowledgeEntry(null)).toBe('REKREATIVE');
    expect(getClientNameForKnowledgeEntry('client-acme')).toBe('Acme Co');
    expect(getClientNameForKnowledgeEntry('client-does-not-exist')).toBe('Cliente desconocido');
  });

  // Backend V1: KnowledgeBoard passes the canonical PostgreSQL clients list
  // explicitly (useClientsRegistry()) instead of relying on the legacy
  // localStorage fallback.
  it('resolves from an explicitly-passed clients list', () => {
    const clients = [{ id: 'client-acme', name: 'Acme Co' }];
    expect(getClientNameForKnowledgeEntry('client-acme', clients)).toBe('Acme Co');
    expect(getClientNameForKnowledgeEntry('client-does-not-exist', clients)).toBe('Cliente desconocido');
  });
});

describe('K: search behavior is unchanged — plain substring match, no ranking/fuzzy/semantic behavior', () => {
  const entries: KnowledgeEntry[] = [
    {
      id: 'k-search-1',
      scope: 'internal',
      clientId: null,
      title: 'Meta Ads qualification framework',
      type: 'strategy',
      tags: ['leads', 'framework'],
      summary: 'How we prioritize inbound leads',
      content: 'Budget, timeline, decision maker.',
      source: 'analysis',
      sourceLabel: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      dataSource: 'demo',
    },
  ];

  it('does not match on typos, synonyms, or partial semantic overlap — proves no fuzzy/AI layer exists', () => {
    expect(searchKnowledgeEntries(entries, 'metaads')).toEqual([]); // missing space — substring only
    expect(searchKnowledgeEntries(entries, 'prospects')).toEqual([]); // synonym of "leads" — no semantic match
    expect(searchKnowledgeEntries(entries, 'qualifying')).toEqual([]); // stem of "qualification" — no fuzzy match
  });

  it('matches only an exact case-insensitive substring, same as before', () => {
    expect(searchKnowledgeEntries(entries, 'qualification').map((e) => e.id)).toEqual(['k-search-1']);
  });
});

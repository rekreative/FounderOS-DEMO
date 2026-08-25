import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStoreIfNeeded as initializeClientsStoreIfNeeded } from '@/lib/clients';
import {
  KNOWLEDGE_SCOPE_OPTIONS,
  KNOWLEDGE_SOURCE_OPTIONS,
  KNOWLEDGE_STATUS_OPTIONS,
  KNOWLEDGE_TYPE_OPTIONS,
  archiveKnowledgeEntry,
  createKnowledgeEntry,
  getClientNameForKnowledgeEntry,
  getKnowledgeEntries,
  getKnowledgeEntryById,
  getKnowledgeScopeLabel,
  getKnowledgeSourceLabel,
  getKnowledgeStatusLabel,
  getKnowledgeTypeLabel,
  initializeKnowledgeStoreIfNeeded,
  normalizeTags,
  restoreKnowledgeEntry,
  searchKnowledgeEntries,
  summarizeKnowledgeEntries,
  updateKnowledgeEntry,
  type KnowledgeEntry,
} from '@/lib/knowledge-entries';

// Same in-memory localStorage stand-in as tests/content-items.test.ts and
// tests/clients.test.ts — this suite runs under vitest's `node` environment
// (no window/localStorage by default), and CRUD/scope-invariant/filtering
// behavior needs a real persistence layer to exercise meaningfully.

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

describe('server-side (no window) behavior', () => {
  it('initializeKnowledgeStoreIfNeeded falls back to in-memory seed data', () => {
    const seeded = initializeKnowledgeStoreIfNeeded();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((entry) => entry.dataSource === 'demo')).toBe(true);
  });

  it('getKnowledgeEntries returns an empty array without a window', () => {
    expect(getKnowledgeEntries()).toEqual([]);
  });

  it('createKnowledgeEntry succeeds for any non-empty clientId without a window — no client-registry lookup', () => {
    // G-Brain Truth V1: client existence is no longer verified against any
    // client registry (that registry was the obsolete lib/clients.ts
    // localStorage mirror, which silently broke writes for real PostgreSQL
    // clients created after the Clients cutover). Only a non-empty clientId
    // is required — see assertScopeInvariant in lib/knowledge-entries.ts.
    const created = createKnowledgeEntry({
      scope: 'client',
      clientId: 'client-does-not-exist',
      title: 'Test entry',
      type: 'decision',
      source: 'manual',
    });
    expect(created.clientId).toBe('client-does-not-exist');
  });

  it('createKnowledgeEntry rejects scope client with no clientId, even without a window', () => {
    expect(() =>
      createKnowledgeEntry({
        scope: 'client',
        title: 'No client',
        type: 'decision',
        source: 'manual',
      }),
    ).toThrow('A client-scoped knowledge entry requires a clientId');
  });

  it('createKnowledgeEntry with scope internal succeeds without a window (no client lookup needed)', () => {
    const created = createKnowledgeEntry({
      scope: 'internal',
      title: 'Internal entry',
      type: 'sop',
      source: 'manual',
    });
    expect(created.scope).toBe('internal');
    expect(created.clientId).toBeNull();
  });
});

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

describe('CRUD + scope invariant (browser-like storage)', () => {
  beforeEach(() => {
    installBrowserLikeStorage();
    initializeClientsStoreIfNeeded();
    initializeKnowledgeStoreIfNeeded();
  });

  afterEach(() => {
    uninstallBrowserLikeStorage();
  });

  it('seeds demo knowledge entries spanning internal/client scope, several types, and at least one archived entry', () => {
    const entries = getKnowledgeEntries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.dataSource === 'demo')).toBe(true);
    expect(entries.some((entry) => entry.scope === 'internal')).toBe(true);
    expect(entries.some((entry) => entry.scope === 'client')).toBe(true);
    expect(entries.some((entry) => entry.status === 'archived')).toBe(true);
    const typesSeen = new Set(entries.map((entry) => entry.type));
    expect(typesSeen.size).toBeGreaterThan(1);
  });

  it('createKnowledgeEntry persists a well-formed record for a real client', () => {
    const created = createKnowledgeEntry({
      scope: 'client',
      clientId: 'client-acme',
      title: 'New entry',
      type: 'decision',
      source: 'meeting',
      sourceLabel: 'Weekly sync',
      tags: ['  Test  ', 'test'],
    });
    expect(created.id).toMatch(/^knowledge-/);
    expect(created.clientId).toBe('client-acme');
    expect(created.status).toBe('active'); // default status
    expect(created.dataSource).toBe('manual'); // default when unspecified
    expect(created.tags).toEqual(['Test']); // normalized/deduped
    expect(getKnowledgeEntryById(created.id)).not.toBeNull();
  });

  it('createKnowledgeEntry rejects scope client with no clientId', () => {
    expect(() =>
      createKnowledgeEntry({
        scope: 'client',
        title: 'No client',
        type: 'decision',
        source: 'manual',
      }),
    ).toThrow('A client-scoped knowledge entry requires a clientId');
  });

  it('createKnowledgeEntry succeeds for a real (non-seed) PostgreSQL-style clientId — the write-bug regression test', () => {
    // Mirrors a real client created through lib/api/clients.ts /
    // lib/server/clients-repo.ts's generateClientId() scheme
    // (`client-<base36 timestamp>-<n>`), which never appears in the
    // localStorage seed list (client-acme/client-northwind/client-lumen).
    // Before G-Brain Truth V1 this threw "Cannot create knowledge entry for
    // a missing client id" for every real client — create, edit, archive,
    // and restore all shared the same broken invariant (updateKnowledgeEntry
    // re-runs it whenever the merged scope is 'client').
    const realClientId = `client-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;

    const created = createKnowledgeEntry({
      scope: 'client',
      clientId: realClientId,
      title: 'Real client entry',
      type: 'client_context',
      source: 'manual',
    });
    expect(created.clientId).toBe(realClientId);
    expect(created.dataSource).toBe('manual');
    expect(getKnowledgeEntryById(created.id)).not.toBeNull();

    const edited = updateKnowledgeEntry(created.id, { title: 'Real client entry, edited' });
    expect(edited?.title).toBe('Real client entry, edited');

    const archived = archiveKnowledgeEntry(created.id);
    expect(archived?.status).toBe('archived');

    const restored = restoreKnowledgeEntry(created.id);
    expect(restored?.status).toBe('active');

    const realClientEntries = getKnowledgeEntries(realClientId);
    expect(realClientEntries.some((entry) => entry.id === created.id)).toBe(true);
    expect(getKnowledgeEntries('client-acme').some((entry) => entry.id === created.id)).toBe(false);
  });

  it('createKnowledgeEntry forces clientId to null for scope internal even if one is passed', () => {
    const created = createKnowledgeEntry({
      scope: 'internal',
      clientId: 'client-acme',
      title: 'Should not keep client',
      type: 'sop',
      source: 'manual',
    });
    expect(created.scope).toBe('internal');
    expect(created.clientId).toBeNull();
  });

  it('updateKnowledgeEntry changes fields and bumps updatedAt', async () => {
    const created = createKnowledgeEntry({
      scope: 'internal',
      title: 'Original title',
      type: 'sop',
      source: 'manual',
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const updated = updateKnowledgeEntry(created.id, { title: 'Updated title' });
    expect(updated?.title).toBe('Updated title');
    expect(updated?.id).toBe(created.id);
    expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThan(new Date(created.updatedAt).getTime());
  });

  it('updateKnowledgeEntry switching scope to internal clears clientId', () => {
    const created = createKnowledgeEntry({
      scope: 'client',
      clientId: 'client-acme',
      title: 'Client entry',
      type: 'client_context',
      source: 'client',
    });
    const updated = updateKnowledgeEntry(created.id, { scope: 'internal' });
    expect(updated?.scope).toBe('internal');
    expect(updated?.clientId).toBeNull();
  });

  it('updateKnowledgeEntry switching scope to client without a valid clientId throws', () => {
    const created = createKnowledgeEntry({
      scope: 'internal',
      title: 'Internal entry',
      type: 'sop',
      source: 'manual',
    });
    expect(() => updateKnowledgeEntry(created.id, { scope: 'client', clientId: null })).toThrow(
      'A client-scoped knowledge entry requires a clientId',
    );
  });

  it('updateKnowledgeEntry returns null for a missing id', () => {
    expect(updateKnowledgeEntry('knowledge-does-not-exist', { title: 'x' })).toBeNull();
  });

  it('archiveKnowledgeEntry sets status to archived without removing the record (no hard delete)', () => {
    const created = createKnowledgeEntry({
      scope: 'internal',
      title: 'To archive',
      type: 'decision',
      source: 'manual',
    });
    const archived = archiveKnowledgeEntry(created.id);
    expect(archived?.status).toBe('archived');
    // still retrievable — archiving is not deleting
    expect(getKnowledgeEntryById(created.id)?.status).toBe('archived');
    expect(getKnowledgeEntries().some((entry) => entry.id === created.id)).toBe(true);
  });

  it('restoreKnowledgeEntry sets an archived entry back to active', () => {
    const created = createKnowledgeEntry({
      scope: 'internal',
      title: 'To restore',
      type: 'decision',
      source: 'manual',
    });
    archiveKnowledgeEntry(created.id);
    const restored = restoreKnowledgeEntry(created.id);
    expect(restored?.status).toBe('active');
  });

  it('getKnowledgeEntries(clientId) returns only that client\'s entries — excludes internal and other clients', () => {
    createKnowledgeEntry({
      scope: 'client',
      clientId: 'client-acme',
      title: 'Acme entry',
      type: 'decision',
      source: 'manual',
    });
    createKnowledgeEntry({
      scope: 'client',
      clientId: 'client-northwind',
      title: 'Northwind entry',
      type: 'decision',
      source: 'manual',
    });
    createKnowledgeEntry({
      scope: 'internal',
      title: 'Internal entry',
      type: 'sop',
      source: 'manual',
    });

    const acmeEntries = getKnowledgeEntries('client-acme');
    expect(acmeEntries.length).toBeGreaterThan(0);
    expect(acmeEntries.every((entry) => entry.clientId === 'client-acme')).toBe(true);
    expect(acmeEntries.some((entry) => entry.scope === 'internal')).toBe(false);
    expect(acmeEntries.some((entry) => entry.clientId === 'client-northwind')).toBe(false);
  });

  it('getClientNameForKnowledgeEntry resolves a real client name and labels internal/unknown honestly', () => {
    expect(getClientNameForKnowledgeEntry(null)).toBe('REKREATIVE');
    expect(getClientNameForKnowledgeEntry('client-acme')).toBe('Acme Co');
    expect(getClientNameForKnowledgeEntry('client-does-not-exist')).toBe('Cliente desconocido');
  });

  // Backend V1: KnowledgeBoard passes the canonical PostgreSQL clients list
  // explicitly (useClientsRegistry()) instead of relying on the legacy
  // localStorage fallback.
  it('getClientNameForKnowledgeEntry resolves from an explicitly-passed clients list', () => {
    const clients = [{ id: 'client-acme', name: 'Acme Co' }];
    expect(getClientNameForKnowledgeEntry('client-acme', clients)).toBe('Acme Co');
    expect(getClientNameForKnowledgeEntry('client-does-not-exist', clients)).toBe('Cliente desconocido');
  });
});

// G-Brain Truth V1 — manual-only-by-default contract. KnowledgeBoard and
// ClientKnowledgePanel both apply the same `entry.dataSource === 'manual'`
// filter (a "Mostrar demo" toggle re-includes demo rows in both). That
// filtering lives in the components, not in lib/knowledge-entries.ts — this
// suite proves the underlying data contract those components depend on:
// summarizeKnowledgeEntries computes honestly over whatever set it's given,
// so a manual-only filter upstream is sufficient to keep demo rows out of
// every KPI, and toggling it back in is sufficient to bring them back.
describe('manual-only-by-default contract (dataSource filtering upstream of summarizeKnowledgeEntries)', () => {
  beforeEach(() => {
    installBrowserLikeStorage();
    initializeClientsStoreIfNeeded();
    initializeKnowledgeStoreIfNeeded();
  });

  afterEach(() => {
    uninstallBrowserLikeStorage();
  });

  it('H/I: default (manual-only) filtering excludes every seeded demo row from the operational set and its KPI summary', () => {
    createKnowledgeEntry({
      scope: 'internal',
      title: 'Manually captured decision',
      type: 'decision',
      source: 'manual',
    });

    const allEntries = getKnowledgeEntries();
    expect(allEntries.some((entry) => entry.dataSource === 'demo')).toBe(true); // seed data present

    const manualOnly = allEntries.filter((entry) => entry.dataSource === 'manual');
    expect(manualOnly.length).toBe(1);
    expect(manualOnly.every((entry) => entry.dataSource === 'manual')).toBe(true);

    const summary = summarizeKnowledgeEntries(manualOnly);
    expect(summary.activeTotal).toBe(1);
    expect(summary.internal).toBe(1);
    expect(summary.client).toBe(0);
    expect(summary.clientsWithKnowledge).toBe(0);
  });

  it('J: enabling demo visibility (no filter) includes demo rows in the KPI summary again', () => {
    const allEntries = getKnowledgeEntries();
    const summaryWithDemo = summarizeKnowledgeEntries(allEntries);
    // Matches the seed suite above: 5 internal + 3 client demo entries exist,
    // so both counts are > 0 as soon as demo rows are back in view.
    expect(summaryWithDemo.internal).toBeGreaterThan(0);
    expect(summaryWithDemo.client).toBeGreaterThan(0);
    expect(summaryWithDemo.activeTotal).toBeGreaterThan(1);
  });

  it('a client-tab-style manual-only summary excludes that client\'s demo knowledge and reflects only its manual entries', () => {
    createKnowledgeEntry({
      scope: 'client',
      clientId: 'client-acme',
      title: 'Real manual note for Acme',
      type: 'client_context',
      source: 'manual',
    });

    const acmeEntries = getKnowledgeEntries('client-acme');
    expect(acmeEntries.some((entry) => entry.dataSource === 'demo')).toBe(true); // Acme has seeded demo knowledge too

    const manualOnlySummary = summarizeKnowledgeEntries(acmeEntries.filter((entry) => entry.dataSource === 'manual'));
    expect(manualOnlySummary.activeTotal).toBe(1);
    expect(manualOnlySummary.client).toBe(1);

    // Sanity check: the mixed (pre-Truth-V1) summary would have shown more
    // than the one manual entry, since Acme's seeded demo entry is also
    // active/client-scoped.
    const mixedSummary = summarizeKnowledgeEntries(acmeEntries);
    expect(mixedSummary.activeTotal).toBeGreaterThan(manualOnlySummary.activeTotal);
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

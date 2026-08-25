import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStoreIfNeeded as initializeClientsStoreIfNeeded } from '@/lib/clients';
import {
  CONTENT_FORMAT_OPTIONS,
  CONTENT_PLATFORM_OPTIONS,
  CONTENT_SCOPE_OPTIONS,
  CONTENT_STATUS_OPTIONS,
  createContentItem,
  deleteContentItem,
  getClientNameForContentItem,
  getContentFormatLabel,
  getContentItemById,
  getContentItems,
  getContentPlatformLabel,
  getContentScopeLabel,
  getContentStatusLabel,
  initializeContentStoreIfNeeded,
  isContentActive,
  isContentOverdue,
  setContentStatus,
  summarizeContentItems,
  updateContentItem,
  type ContentItem,
} from '@/lib/content-items';

// This suite runs under vitest's `node` environment (see vitest.config.ts),
// which has no window/localStorage by default — same situation
// tests/automations.test.ts and tests/clients.test.ts document. The pure
// derivation/label helpers and the SSR-safe fallbacks are tested against
// that real "no window" condition below.
//
// The CRUD + scope-invariant + client-filtering behavior, however, needs an
// actual persistence layer to exercise meaningfully (e.g. "getContentItems
// excludes another client's items" requires real stored items to filter).
// Rather than adding jsdom as a new dependency, a minimal in-memory
// localStorage stand-in is installed on `globalThis.window` for those
// suites only, then torn down — lib/content-items.ts and lib/clients.ts
// both branch on `typeof window === 'undefined'`, so this is enough to make
// them behave exactly as they do in a browser.

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
  // lib/clients.ts reads/writes the bare global `localStorage`, while
  // lib/content-items.ts (and lib/automations.ts, lib/leads.ts, ...) go
  // through `window.localStorage` — set both so every module sees the same
  // backing store.
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
  (globalThis as unknown as { localStorage: unknown }).localStorage = storage;
}

function uninstallBrowserLikeStorage() {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
}

describe('server-side (no window) behavior', () => {
  it('initializeContentStoreIfNeeded falls back to in-memory seed data', () => {
    const seeded = initializeContentStoreIfNeeded();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((item) => item.dataSource === 'demo')).toBe(true);
  });

  it('getContentItems returns an empty array without a window', () => {
    expect(getContentItems()).toEqual([]);
  });

  it('createContentItem succeeds for any non-empty clientId without a window — no client-registry lookup', () => {
    // Content Truth V1: client existence is no longer verified against any
    // client registry (that registry was the obsolete lib/clients.ts
    // localStorage mirror, which silently broke writes for real PostgreSQL
    // clients created after the Clients cutover). Only a non-empty clientId
    // is required — see assertScopeInvariant in lib/content-items.ts.
    const created = createContentItem({
      scope: 'client',
      clientId: 'client-does-not-exist',
      title: 'Test piece',
      format: 'reel',
      platform: 'instagram',
      owner: 'Test Owner',
    });
    expect(created.clientId).toBe('client-does-not-exist');
  });

  it('createContentItem with scope internal succeeds without a window (no client lookup needed)', () => {
    const created = createContentItem({
      scope: 'internal',
      title: 'Internal piece',
      format: 'blog',
      platform: 'blog',
      owner: 'Equipo REKREATIVE',
    });
    expect(created.scope).toBe('internal');
    expect(created.clientId).toBeNull();
  });
});

describe('label helpers', () => {
  it('resolve known ids to human labels', () => {
    expect(getContentScopeLabel('client')).toBe('Cliente');
    expect(getContentScopeLabel('internal')).toBe('Interno · REKREATIVE');
    expect(getContentStatusLabel('recording')).toBe('Grabación');
    expect(getContentFormatLabel('carousel')).toBe('Carrusel');
    expect(getContentPlatformLabel('tiktok')).toBe('TikTok');
  });

  it('falls back to the raw id for an unrecognized value rather than throwing', () => {
    expect(getContentStatusLabel('archived' as never)).toBe('archived');
  });
});

describe('controlled enums', () => {
  it('scope is exactly client/internal', () => {
    expect(CONTENT_SCOPE_OPTIONS.map((o) => o.id)).toEqual(['client', 'internal']);
  });

  it('status is exactly the 7-state production pipeline, including cancelled, and never includes ambiguous substates', () => {
    expect(CONTENT_STATUS_OPTIONS.map((o) => o.id)).toEqual([
      'idea',
      'scripting',
      'recording',
      'editing',
      'ready',
      'published',
      'cancelled',
    ]);
    const ids = CONTENT_STATUS_OPTIONS.map((o) => o.id);
    expect(ids).not.toContain('ready_to_record');
    expect(ids).not.toContain('review');
  });

  it('format and platform are non-empty controlled sets', () => {
    expect(CONTENT_FORMAT_OPTIONS.length).toBeGreaterThan(0);
    expect(CONTENT_PLATFORM_OPTIONS.length).toBeGreaterThan(0);
  });
});

describe('isContentActive', () => {
  it('is true for every non-terminal status', () => {
    for (const status of ['idea', 'scripting', 'recording', 'editing', 'ready'] as const) {
      expect(isContentActive({ status })).toBe(true);
    }
  });

  it('is false for published and cancelled', () => {
    expect(isContentActive({ status: 'published' })).toBe(false);
    expect(isContentActive({ status: 'cancelled' })).toBe(false);
  });
});

describe('isContentOverdue', () => {
  it('is false when there is no planned date', () => {
    expect(isContentOverdue({ plannedPublishDate: null, status: 'idea' })).toBe(false);
  });

  it('is true when the planned date is in the past and the item is still active', () => {
    expect(isContentOverdue({ plannedPublishDate: '2020-01-01', status: 'scripting' })).toBe(true);
  });

  it('is false when the planned date is in the past but the item is published', () => {
    expect(isContentOverdue({ plannedPublishDate: '2020-01-01', status: 'published' })).toBe(false);
  });

  it('is false when the planned date is in the past but the item is cancelled', () => {
    expect(isContentOverdue({ plannedPublishDate: '2020-01-01', status: 'cancelled' })).toBe(false);
  });

  it('is false when the planned date is in the future', () => {
    expect(isContentOverdue({ plannedPublishDate: '2099-01-01', status: 'idea' })).toBe(false);
  });
});

describe('summarizeContentItems', () => {
  const items: ContentItem[] = (
    [
      ['idea', null],
      ['scripting', '2020-01-01'],
      ['recording', null],
      ['editing', null],
      ['ready', null],
      ['published', '2020-01-01'],
      ['cancelled', '2020-01-01'],
    ] as const
  ).map(([status, plannedPublishDate], index) => ({
    id: `content-summary-${index}`,
    scope: 'internal',
    clientId: null,
    title: `Item ${index}`,
    format: 'reel',
    platform: 'instagram',
    status,
    pillar: null,
    hook: '',
    angle: '',
    script: '',
    notes: '',
    owner: 'Owner',
    plannedPublishDate,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    dataSource: 'demo',
  }));

  it('counts each status exactly once', () => {
    const summary = summarizeContentItems(items);
    expect(summary.total).toBe(7);
    expect(summary.idea).toBe(1);
    expect(summary.scripting).toBe(1);
    expect(summary.recording).toBe(1);
    expect(summary.editing).toBe(1);
    expect(summary.ready).toBe(1);
    expect(summary.published).toBe(1);
    expect(summary.cancelled).toBe(1);
  });

  it('active excludes only published and cancelled', () => {
    expect(summarizeContentItems(items).active).toBe(5);
  });

  it('overdue counts only the active item with a past planned date (scripting), not published/cancelled', () => {
    expect(summarizeContentItems(items).overdue).toBe(1);
  });
});

describe('CRUD + scope invariant (browser-like storage)', () => {
  beforeEach(() => {
    installBrowserLikeStorage();
    initializeClientsStoreIfNeeded();
    initializeContentStoreIfNeeded();
  });

  afterEach(() => {
    uninstallBrowserLikeStorage();
  });

  it('seeds demo content items covering every status at least once, all dataSource demo', () => {
    const items = getContentItems();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.dataSource === 'demo')).toBe(true);
    const statusesSeen = new Set(items.map((item) => item.status));
    for (const option of CONTENT_STATUS_OPTIONS) {
      expect(statusesSeen.has(option.id)).toBe(true);
    }
  });

  it('seeds at least one overdue, one published, one cancelled, and one internal item', () => {
    const items = getContentItems();
    expect(items.some((item) => isContentOverdue(item))).toBe(true);
    expect(items.some((item) => item.status === 'published')).toBe(true);
    expect(items.some((item) => item.status === 'cancelled')).toBe(true);
    expect(items.some((item) => item.scope === 'internal')).toBe(true);
  });

  it('createContentItem persists a well-formed record for a real client', () => {
    const created = createContentItem({
      scope: 'client',
      clientId: 'client-acme',
      title: 'New piece',
      format: 'reel',
      platform: 'instagram',
      owner: 'Test Owner',
    });
    expect(created.id).toMatch(/^content-/);
    expect(created.clientId).toBe('client-acme');
    expect(created.status).toBe('idea'); // default status
    expect(created.dataSource).toBe('manual'); // default when unspecified
    expect(getContentItemById(created.id)).not.toBeNull();
  });

  it('createContentItem rejects scope client with no clientId', () => {
    expect(() =>
      createContentItem({
        scope: 'client',
        title: 'No client',
        format: 'reel',
        platform: 'instagram',
        owner: 'Test Owner',
      }),
    ).toThrow('A client-scoped content item requires a clientId');
  });

  it('createContentItem succeeds for a real (non-seed) PostgreSQL-style clientId — the write-bug regression test', () => {
    // Mirrors a real client created through lib/api/clients.ts /
    // lib/server/clients-repo.ts's generateClientId() scheme
    // (`client-<base36 timestamp>-<n>`), which never appears in the
    // localStorage seed list (client-acme/client-northwind/client-lumen).
    // Before Content Truth V1 this threw "Cannot create content item for a
    // missing client id" for every real client.
    const realClientId = `client-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
    const created = createContentItem({
      scope: 'client',
      clientId: realClientId,
      title: 'Real client piece',
      format: 'reel',
      platform: 'instagram',
      owner: 'Test Owner',
    });
    expect(created.clientId).toBe(realClientId);
    expect(created.dataSource).toBe('manual');
    expect(getContentItemById(created.id)).not.toBeNull();
  });

  it('createContentItem forces clientId to null for scope internal even if one is passed', () => {
    const created = createContentItem({
      scope: 'internal',
      clientId: 'client-acme',
      title: 'Should not keep client',
      format: 'blog',
      platform: 'blog',
      owner: 'Equipo REKREATIVE',
    });
    expect(created.scope).toBe('internal');
    expect(created.clientId).toBeNull();
  });

  it('updateContentItem changes fields and bumps updatedAt', () => {
    const created = createContentItem({
      scope: 'client',
      clientId: 'client-acme',
      title: 'Original title',
      format: 'reel',
      platform: 'instagram',
      owner: 'Test Owner',
    });
    const updated = updateContentItem(created.id, { title: 'Updated title' });
    expect(updated?.title).toBe('Updated title');
    expect(updated?.id).toBe(created.id);
  });

  it('updateContentItem switching scope to internal clears clientId', () => {
    const created = createContentItem({
      scope: 'client',
      clientId: 'client-acme',
      title: 'Client piece',
      format: 'reel',
      platform: 'instagram',
      owner: 'Test Owner',
    });
    const updated = updateContentItem(created.id, { scope: 'internal' });
    expect(updated?.scope).toBe('internal');
    expect(updated?.clientId).toBeNull();
  });

  it('updateContentItem switching scope to client without a valid clientId throws', () => {
    const created = createContentItem({
      scope: 'internal',
      title: 'Internal piece',
      format: 'blog',
      platform: 'blog',
      owner: 'Equipo REKREATIVE',
    });
    expect(() => updateContentItem(created.id, { scope: 'client', clientId: null })).toThrow(
      'A client-scoped content item requires a clientId',
    );
  });

  it('updateContentItem returns null for a missing id', () => {
    expect(updateContentItem('content-does-not-exist', { title: 'x' })).toBeNull();
  });

  it('setContentStatus moves an item through the pipeline', () => {
    const created = createContentItem({
      scope: 'internal',
      title: 'Pipeline piece',
      format: 'reel',
      platform: 'instagram',
      owner: 'Equipo REKREATIVE',
    });
    expect(created.status).toBe('idea');
    const scripted = setContentStatus(created.id, 'scripting');
    expect(scripted?.status).toBe('scripting');
    const cancelled = setContentStatus(created.id, 'cancelled');
    expect(cancelled?.status).toBe('cancelled');
  });

  it('deleteContentItem removes the record and returns true; returns false if missing', () => {
    const created = createContentItem({
      scope: 'internal',
      title: 'To delete',
      format: 'reel',
      platform: 'instagram',
      owner: 'Equipo REKREATIVE',
    });
    expect(deleteContentItem(created.id)).toBe(true);
    expect(getContentItemById(created.id)).toBeNull();
    expect(deleteContentItem(created.id)).toBe(false);
  });

  it('getContentItems(clientId) returns only that client\'s items — excludes internal and other clients', () => {
    createContentItem({
      scope: 'client',
      clientId: 'client-acme',
      title: 'Acme piece',
      format: 'reel',
      platform: 'instagram',
      owner: 'Owner A',
    });
    createContentItem({
      scope: 'client',
      clientId: 'client-northwind',
      title: 'Northwind piece',
      format: 'reel',
      platform: 'instagram',
      owner: 'Owner B',
    });
    createContentItem({
      scope: 'internal',
      title: 'Internal piece',
      format: 'blog',
      platform: 'blog',
      owner: 'Equipo REKREATIVE',
    });

    const acmeItems = getContentItems('client-acme');
    expect(acmeItems.length).toBeGreaterThan(0);
    expect(acmeItems.every((item) => item.clientId === 'client-acme')).toBe(true);
    expect(acmeItems.some((item) => item.scope === 'internal')).toBe(false);
    expect(acmeItems.some((item) => item.clientId === 'client-northwind')).toBe(false);
  });

  it('getClientNameForContentItem resolves a real client name and labels internal/unknown honestly', () => {
    expect(getClientNameForContentItem(null)).toBe('Interno · REKREATIVE');
    expect(getClientNameForContentItem('client-acme')).toBe('Acme Co');
    expect(getClientNameForContentItem('client-does-not-exist')).toBe('Cliente desconocido');
  });
});

// Content Truth V1 — manual-only-by-default contract. ContentBoard,
// ClientContentPanel, and the client Overview tile all apply the same
// `item.dataSource === 'manual'` filter (a "Mostrar demo" toggle re-includes
// demo rows in the two board components; the Overview tile never does).
// That filtering lives in the components, not in lib/content-items.ts — this
// suite proves the underlying data contract those components depend on:
// summarizeContentItems computes honestly over whatever set it's given, so a
// manual-only filter upstream is sufficient to keep demo rows out of every
// KPI, and toggling it back in is sufficient to bring them back.
describe('manual-only-by-default contract (dataSource filtering upstream of summarizeContentItems)', () => {
  beforeEach(() => {
    installBrowserLikeStorage();
    initializeClientsStoreIfNeeded();
    initializeContentStoreIfNeeded();
  });

  afterEach(() => {
    uninstallBrowserLikeStorage();
  });

  it('F/G: default (manual-only) filtering excludes every seeded demo row from the operational set and its KPI summary', () => {
    createContentItem({
      scope: 'internal',
      title: 'Manually planned piece',
      format: 'reel',
      platform: 'instagram',
      owner: 'Equipo REKREATIVE',
    });

    const allItems = getContentItems();
    expect(allItems.some((item) => item.dataSource === 'demo')).toBe(true); // seed data present

    const manualOnly = allItems.filter((item) => item.dataSource === 'manual');
    expect(manualOnly.length).toBe(1);
    expect(manualOnly.every((item) => item.dataSource === 'manual')).toBe(true);

    const summary = summarizeContentItems(manualOnly);
    expect(summary.total).toBe(1);
    // The 18-row seed set covers every status at least once (see the seed
    // suite above) — if any demo row leaked in, active/ready/published would
    // all be > 0 too, not just the one manual "idea" piece created here.
    expect(summary.active).toBe(1);
    expect(summary.ready).toBe(0);
    expect(summary.published).toBe(0);
  });

  it('H: enabling demo visibility (no filter) includes demo rows in the KPI summary again', () => {
    const allItems = getContentItems();
    const summaryWithDemo = summarizeContentItems(allItems);
    // Matches the seed suite above: every status appears at least once
    // across the demo set, so both active and published are non-zero as
    // soon as demo rows are back in view.
    expect(summaryWithDemo.published).toBeGreaterThan(0);
    expect(summaryWithDemo.total).toBeGreaterThan(1);
  });

  it('I: a client Overview-style manual-only summary excludes that client\'s demo content and reflects only its manual pieces', () => {
    createContentItem({
      scope: 'client',
      clientId: 'client-acme',
      title: 'Real manual piece for Acme',
      format: 'carousel',
      platform: 'instagram',
      status: 'ready',
      owner: 'Test Owner',
    });

    const acmeItems = getContentItems('client-acme');
    expect(acmeItems.some((item) => item.dataSource === 'demo')).toBe(true); // Acme has seeded demo content too

    const manualOnlyOverviewSummary = summarizeContentItems(
      acmeItems.filter((item) => item.dataSource === 'manual'),
    );
    expect(manualOnlyOverviewSummary.total).toBe(1);
    expect(manualOnlyOverviewSummary.ready).toBe(1);

    // Sanity check: the mixed (pre-Truth-V1-fix) summary would have shown
    // more active/ready pieces than actually exist as real manual work.
    const mixedSummary = summarizeContentItems(acmeItems);
    expect(mixedSummary.total).toBeGreaterThan(manualOnlyOverviewSummary.total);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStoreIfNeeded as initializeClientsStoreIfNeeded } from '@/lib/clients';
import {
  createCampaign,
  getCampaignById,
  getCampaigns,
  getClientNameForCampaign,
  initializeMetaCampaignsStoreIfNeeded,
  updateCampaign,
  type MetaCampaign,
} from '@/lib/meta-ads';

// No lib/meta-ads.ts unit suite existed before this pass (2026-08-20 —
// REKREATIVE-vs-client scope). This file covers the new scope/clientId
// invariant only, following the same browser-like-storage pattern already
// established in tests/content-items.test.ts / tests/leads.test.ts.

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
  it('getCampaigns returns an empty array without a window', () => {
    expect(getCampaigns()).toEqual([]);
  });

  it('createCampaign rejects a client id that cannot be found (client list is empty without window)', () => {
    expect(() =>
      createCampaign({
        scope: 'client',
        clientId: 'client-does-not-exist',
        name: 'No window campaign',
        objective: 'leads',
        budgetType: 'daily',
        startDate: '2026-01-01',
      }),
    ).toThrow('Cannot create campaign for a missing client id');
  });

  it('createCampaign with scope internal succeeds without a window (no client lookup needed)', () => {
    const created = createCampaign({
      scope: 'internal',
      name: 'Internal, no window',
      objective: 'leads',
      budgetType: 'daily',
      startDate: '2026-01-01',
    });
    expect(created.scope).toBe('internal');
    expect(created.clientId).toBeNull();
  });
});

describe('getClientNameForCampaign', () => {
  it('returns Interno for a null clientId, never a fabricated client name', () => {
    expect(getClientNameForCampaign(null)).toBe('Interno');
  });
});

describe('CRUD + scope invariant (browser-like storage)', () => {
  beforeEach(() => {
    installBrowserLikeStorage();
    initializeClientsStoreIfNeeded();
    initializeMetaCampaignsStoreIfNeeded();
  });

  afterEach(() => {
    uninstallBrowserLikeStorage();
  });

  it('seeds both a REKREATIVE-internal campaign and client campaigns, all with a scope field', () => {
    const campaigns = getCampaigns();
    expect(campaigns.length).toBeGreaterThan(0);
    expect(campaigns.every((c) => c.scope === 'internal' || c.scope === 'client')).toBe(true);
    expect(campaigns.some((c) => c.scope === 'internal' && c.clientId === null)).toBe(true);
    expect(campaigns.some((c) => c.scope === 'client' && c.clientId != null)).toBe(true);
  });

  it('a record persisted before `scope` existed normalizes to client on read, never dropped or crashed on', () => {
    // Simulate pre-migration data: a MetaCampaign row with no `scope` field
    // at all, exactly what JSON.parse yields for anything written before
    // this pass.
    const legacy = { ...getCampaigns()[0] } as Partial<MetaCampaign>;
    delete (legacy as { scope?: unknown }).scope;
    window.localStorage.setItem('rek_meta_campaigns_v1', JSON.stringify([legacy]));

    const [normalized] = getCampaigns();
    expect(normalized.scope).toBe('client');
    expect(normalized.clientId).toBe(legacy.clientId);
  });

  it('createCampaign defaults to scope client when scope is omitted, preserving prior call-site behavior', () => {
    const created = createCampaign({
      clientId: 'client-acme',
      name: 'Legacy-style call',
      objective: 'leads',
      budgetType: 'daily',
      startDate: '2026-01-01',
    });
    expect(created.scope).toBe('client');
    expect(created.clientId).toBe('client-acme');
  });

  it('createCampaign persists a well-formed record for a real client', () => {
    const created = createCampaign({
      scope: 'client',
      clientId: 'client-acme',
      name: 'New client campaign',
      objective: 'leads',
      budgetType: 'daily',
      startDate: '2026-01-01',
    });
    expect(created.id).toMatch(/^campaign-/);
    expect(created.clientId).toBe('client-acme');
    expect(created.status).toBe('draft'); // default status
    expect(getCampaignById(created.id)).not.toBeNull();
  });

  it('createCampaign rejects scope client with no clientId', () => {
    expect(() =>
      createCampaign({ scope: 'client', name: 'No client', objective: 'leads', budgetType: 'daily', startDate: '2026-01-01' }),
    ).toThrow('A client-scoped campaign requires a clientId');
  });

  it('createCampaign rejects scope client with a clientId that does not exist', () => {
    expect(() =>
      createCampaign({
        scope: 'client',
        clientId: 'client-does-not-exist',
        name: 'Bad client',
        objective: 'leads',
        budgetType: 'daily',
        startDate: '2026-01-01',
      }),
    ).toThrow('Cannot create campaign for a missing client id');
  });

  it('createCampaign forces clientId to null for scope internal even if one is passed', () => {
    const created = createCampaign({
      scope: 'internal',
      clientId: 'client-acme',
      name: 'Should not keep client',
      objective: 'leads',
      budgetType: 'daily',
      startDate: '2026-01-01',
    });
    expect(created.scope).toBe('internal');
    expect(created.clientId).toBeNull();
  });

  it('updateCampaign switching scope to internal clears clientId', () => {
    const created = createCampaign({
      scope: 'client',
      clientId: 'client-acme',
      name: 'Client campaign',
      objective: 'leads',
      budgetType: 'daily',
      startDate: '2026-01-01',
    });
    const updated = updateCampaign(created.id, { scope: 'internal' });
    expect(updated?.scope).toBe('internal');
    expect(updated?.clientId).toBeNull();
  });

  it('updateCampaign switching scope to client without a valid clientId throws', () => {
    const created = createCampaign({
      scope: 'internal',
      name: 'Internal campaign',
      objective: 'leads',
      budgetType: 'daily',
      startDate: '2026-01-01',
    });
    expect(() => updateCampaign(created.id, { scope: 'client', clientId: null })).toThrow(
      'A client-scoped campaign requires a clientId',
    );
  });

  it('updateCampaign returns null for a missing id', () => {
    expect(updateCampaign('campaign-does-not-exist', { name: 'x' })).toBeNull();
  });

  it('getCampaigns(clientId) returns only that client\'s campaigns — excludes internal and other clients (Client Workspace isolation)', () => {
    createCampaign({
      scope: 'client',
      clientId: 'client-acme',
      name: 'Acme campaign',
      objective: 'leads',
      budgetType: 'daily',
      startDate: '2026-01-01',
    });
    createCampaign({
      scope: 'client',
      clientId: 'client-northwind',
      name: 'Northwind campaign',
      objective: 'leads',
      budgetType: 'daily',
      startDate: '2026-01-01',
    });
    createCampaign({
      scope: 'internal',
      name: 'REKREATIVE internal campaign',
      objective: 'leads',
      budgetType: 'daily',
      startDate: '2026-01-01',
    });

    const acmeCampaigns = getCampaigns('client-acme');
    expect(acmeCampaigns.length).toBeGreaterThan(0);
    expect(acmeCampaigns.every((c) => c.clientId === 'client-acme')).toBe(true);
    expect(acmeCampaigns.some((c) => c.scope === 'internal')).toBe(false);
    expect(acmeCampaigns.some((c) => c.clientId === 'client-northwind')).toBe(false);
  });

  it('getCampaigns() with no clientId includes both internal and client campaigns (scope filtering is the caller\'s job)', () => {
    createCampaign({
      scope: 'client',
      clientId: 'client-acme',
      name: 'Acme campaign',
      objective: 'leads',
      budgetType: 'daily',
      startDate: '2026-01-01',
    });
    createCampaign({
      scope: 'internal',
      name: 'REKREATIVE internal campaign',
      objective: 'leads',
      budgetType: 'daily',
      startDate: '2026-01-01',
    });

    const all = getCampaigns();
    expect(all.some((c) => c.scope === 'internal')).toBe(true);
    expect(all.some((c) => c.scope === 'client')).toBe(true);
  });
});

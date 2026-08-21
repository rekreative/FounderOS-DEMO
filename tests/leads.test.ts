import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeStoreIfNeeded as initializeClientsStoreIfNeeded } from '@/lib/clients';
import {
  createLead,
  getClientNameForLead,
  getLeadById,
  getLeads,
  initializeLeadsStoreIfNeeded,
  updateLead,
  type Lead,
} from '@/lib/leads';

// No lib/leads.ts unit suite existed before this pass (2026-08-20 —
// REKREATIVE-vs-client scope). This file covers the new scope/clientId
// invariant only, following the same browser-like-storage pattern already
// established in tests/content-items.test.ts (lib/clients.ts and
// lib/leads.ts both branch on `typeof window === 'undefined'`, so a minimal
// in-memory localStorage stand-in is enough to exercise them exactly as a
// browser would, without adding jsdom as a dependency).

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
  it('getLeads returns an empty array without a window', () => {
    expect(getLeads()).toEqual([]);
  });

  it('createLead rejects a client id that cannot be found (client list is empty without window)', () => {
    expect(() =>
      createLead({ scope: 'client', clientId: 'client-does-not-exist', name: 'No window lead' }),
    ).toThrow('Cannot create lead for a missing client id');
  });

  it('createLead with scope internal succeeds without a window (no client lookup needed)', () => {
    const created = createLead({ scope: 'internal', name: 'Internal, no window' });
    expect(created.scope).toBe('internal');
    expect(created.clientId).toBeNull();
  });
});

describe('getClientNameForLead', () => {
  it('returns Interno for a null clientId, never a fabricated client name', () => {
    expect(getClientNameForLead(null)).toBe('Interno');
  });
});

describe('CRUD + scope invariant (browser-like storage)', () => {
  beforeEach(() => {
    installBrowserLikeStorage();
    initializeClientsStoreIfNeeded();
    initializeLeadsStoreIfNeeded();
  });

  afterEach(() => {
    uninstallBrowserLikeStorage();
  });

  it('seeds both REKREATIVE-internal and client leads, all with a scope field', () => {
    const leads = getLeads();
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((lead) => lead.scope === 'internal' || lead.scope === 'client')).toBe(true);
    expect(leads.some((lead) => lead.scope === 'internal' && lead.clientId === null)).toBe(true);
    expect(leads.some((lead) => lead.scope === 'client' && lead.clientId != null)).toBe(true);
  });

  it('a record persisted before `scope` existed normalizes to client on read, never dropped or crashed on', () => {
    // Simulate pre-migration data: a Lead row with no `scope` field at all,
    // exactly what JSON.parse yields for anything written before this pass.
    const legacy = { ...getLeads()[0] } as Partial<Lead>;
    delete (legacy as { scope?: unknown }).scope;
    window.localStorage.setItem('rek_leads_v1', JSON.stringify([legacy]));

    const [normalized] = getLeads();
    expect(normalized.scope).toBe('client');
    expect(normalized.clientId).toBe(legacy.clientId);
  });

  it('createLead defaults to scope client when scope is omitted, preserving prior call-site behavior', () => {
    const created = createLead({ clientId: 'client-acme', name: 'Legacy-style call' });
    expect(created.scope).toBe('client');
    expect(created.clientId).toBe('client-acme');
  });

  it('createLead persists a well-formed record for a real client', () => {
    const created = createLead({ scope: 'client', clientId: 'client-acme', name: 'New client lead' });
    expect(created.id).toMatch(/^lead-/);
    expect(created.clientId).toBe('client-acme');
    expect(created.stage).toBe('new'); // default stage
    expect(getLeadById(created.id)).not.toBeNull();
  });

  it('createLead rejects scope client with no clientId', () => {
    expect(() => createLead({ scope: 'client', name: 'No client' })).toThrow(
      'A client-scoped lead requires a clientId',
    );
  });

  it('createLead rejects scope client with a clientId that does not exist', () => {
    expect(() =>
      createLead({ scope: 'client', clientId: 'client-does-not-exist', name: 'Bad client' }),
    ).toThrow('Cannot create lead for a missing client id');
  });

  it('createLead forces clientId to null for scope internal even if one is passed', () => {
    const created = createLead({ scope: 'internal', clientId: 'client-acme', name: 'Should not keep client' });
    expect(created.scope).toBe('internal');
    expect(created.clientId).toBeNull();
  });

  it('updateLead switching scope to internal clears clientId', () => {
    const created = createLead({ scope: 'client', clientId: 'client-acme', name: 'Client lead' });
    const updated = updateLead(created.id, { scope: 'internal' });
    expect(updated?.scope).toBe('internal');
    expect(updated?.clientId).toBeNull();
  });

  it('updateLead switching scope to client without a valid clientId throws', () => {
    const created = createLead({ scope: 'internal', name: 'Internal lead' });
    expect(() => updateLead(created.id, { scope: 'client', clientId: null })).toThrow(
      'A client-scoped lead requires a clientId',
    );
  });

  it('updateLead returns null for a missing id', () => {
    expect(updateLead('lead-does-not-exist', { name: 'x' })).toBeNull();
  });

  it('getLeads(clientId) returns only that client\'s leads — excludes internal and other clients (Client Workspace isolation)', () => {
    createLead({ scope: 'client', clientId: 'client-acme', name: 'Acme lead' });
    createLead({ scope: 'client', clientId: 'client-northwind', name: 'Northwind lead' });
    createLead({ scope: 'internal', name: 'REKREATIVE internal lead' });

    const acmeLeads = getLeads('client-acme');
    expect(acmeLeads.length).toBeGreaterThan(0);
    expect(acmeLeads.every((lead) => lead.clientId === 'client-acme')).toBe(true);
    expect(acmeLeads.some((lead) => lead.scope === 'internal')).toBe(false);
    expect(acmeLeads.some((lead) => lead.clientId === 'client-northwind')).toBe(false);
  });

  it('getLeads() with no clientId includes both internal and client leads (scope filtering is the caller\'s job)', () => {
    createLead({ scope: 'client', clientId: 'client-acme', name: 'Acme lead' });
    createLead({ scope: 'internal', name: 'REKREATIVE internal lead' });

    const all = getLeads();
    expect(all.some((lead) => lead.scope === 'internal')).toBe(true);
    expect(all.some((lead) => lead.scope === 'client')).toBe(true);
  });
});

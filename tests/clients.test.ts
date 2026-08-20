import { describe, it, expect } from 'vitest';
import {
  CLIENT_STATUS_OPTIONS,
  createClient,
  deleteClient,
  deleteClientNotes,
  getClientById,
  getClientNotes,
  getClientStatusLabel,
  getClients,
  getSeedClients,
  initializeStoreIfNeeded,
  updateClient,
  updateClientNotes,
  type Client,
} from '@/lib/clients';

// Same rationale as tests/automations.test.ts / tests/integration-connections.test.ts:
// this suite runs under vitest's `node` environment (no window/localStorage).
// What IS testable in node are the pure derivation/label helpers, the seeded
// demo data, and the SSR-safe fallbacks every read/write function falls back
// to when `window` is undefined; CRUD against localStorage needs a browser
// and is exercised by manual verification.

describe('getClientStatusLabel', () => {
  it('resolves every known status id to its Spanish label', () => {
    expect(getClientStatusLabel('active')).toBe('Activo');
    expect(getClientStatusLabel('paused')).toBe('Pausado');
    expect(getClientStatusLabel('prospect')).toBe('Prospecto');
  });

  it('falls back to the raw id for an unrecognized value rather than throwing', () => {
    expect(getClientStatusLabel('archived' as never)).toBe('archived');
  });
});

describe('status enum', () => {
  it('contains exactly the controlled REKREATIVE client status set', () => {
    expect(CLIENT_STATUS_OPTIONS.map((o) => o.id)).toEqual(['active', 'paused', 'prospect']);
  });
});

describe('getSeedClients', () => {
  it('returns the three seeded REKREATIVE demo clients with their controlled ids and statuses', () => {
    const seeded = getSeedClients();
    expect(seeded.map((c) => c.id)).toEqual(['client-acme', 'client-northwind', 'client-lumen']);
    expect(seeded.map((c) => c.status)).toEqual(['active', 'paused', 'prospect']);
  });

  it('returns a fresh array each call — pushing/splicing one result never affects another', () => {
    const first = getSeedClients();
    first.push({ ...first[0], id: 'client-extra' });
    const second = getSeedClients();
    expect(second).toHaveLength(3);
    expect(second.map((c) => c.id)).toEqual(['client-acme', 'client-northwind', 'client-lumen']);
  });
});

describe('initializeStoreIfNeeded — server-side (no window) behavior', () => {
  it('returns the seeded clients directly when there is no window to persist to', () => {
    const result = initializeStoreIfNeeded();
    expect(result.map((c) => c.id)).toEqual(['client-acme', 'client-northwind', 'client-lumen']);
  });
});

describe('createClient — object construction', () => {
  it('builds a well-formed Client from the input, stamping a generated id and createdAt', () => {
    const input: Omit<Client, 'id' | 'createdAt'> = {
      name: 'Test Co',
      sector: 'Retail',
      status: 'prospect',
      service: 'Consulting',
      metaBudgetMonthly: 1200,
      startDate: '2026-08-01',
      owner: 'Kilian',
    };
    const created = createClient(input);
    expect(created.id).toMatch(/^client-/);
    expect(typeof created.createdAt).toBe('string');
    expect(created.name).toBe('Test Co');
    expect(created.sector).toBe('Retail');
    expect(created.status).toBe('prospect');
    expect(created.metaBudgetMonthly).toBe(1200);
  });

  it('generates distinct ids for two clients created back to back', () => {
    const a = createClient({
      name: 'A', sector: 'X', status: 'active', service: 'Y', metaBudgetMonthly: 0, startDate: '2026-01-01', owner: 'Z',
    });
    const b = createClient({
      name: 'B', sector: 'X', status: 'active', service: 'Y', metaBudgetMonthly: 0, startDate: '2026-01-01', owner: 'Z',
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe('read/write CRUD — server-side (no window) fallback behavior', () => {
  // Under node, readStorage()/writeStorage() are no-ops (no localStorage to
  // read from or write to), so every function that depends on persisted state
  // must degrade honestly — never throw, never fabricate a found/updated
  // record. This is the same SSR-safety contract lib/automations.ts and
  // lib/leads.ts already document and rely on.

  it('getClients returns an empty array without a window', () => {
    expect(getClients()).toEqual([]);
  });

  it('getClientById returns null for any id without a window', () => {
    expect(getClientById('client-acme')).toBeNull();
  });

  it('updateClient returns null — nothing can be found to update — without a window', () => {
    expect(updateClient('client-acme', { name: 'Renamed' })).toBeNull();
  });

  it('deleteClient returns false — nothing can be found to delete — without a window', () => {
    expect(deleteClient('client-acme')).toBe(false);
  });

  it('getClientNotes returns an empty string without a window', () => {
    expect(getClientNotes('client-acme')).toBe('');
  });

  it('updateClientNotes and deleteClientNotes no-op silently without a window', () => {
    expect(() => updateClientNotes('client-acme', 'Some note')).not.toThrow();
    expect(() => deleteClientNotes('client-acme')).not.toThrow();
  });
});

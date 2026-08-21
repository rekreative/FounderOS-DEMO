import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { initializeStoreIfNeeded as initializeClientsStoreIfNeeded } from '@/lib/clients';
import {
  AUTOMATION_PLATFORM_OPTIONS,
  createAutomation,
  getAutomationById,
  getAutomationHealth,
  getAutomationRunStats,
  getAutomations,
  getClientNameForAutomation,
  getHealthLabel,
  getPlatformLabel,
  getRunStatusLabel,
  getStatusLabel,
  getTypeLabel,
  initializeAutomationsStoreIfNeeded,
  updateAutomation,
  type Automation,
  type AutomationRun,
} from '@/lib/automations';

// This suite runs under vitest's `node` environment (see vitest.config.ts),
// which has no `window`/`localStorage` by default. Pure derivation helpers
// (health, run stats, labels) and the SSR-safe fallbacks are tested against
// that real "no window" condition below.
//
// The CRUD + scope-invariant + client-filtering behavior (added 2026-08-20
// — REKREATIVE-vs-client scope, mirroring lib/leads.ts / lib/meta-ads.ts)
// needs an actual persistence layer to exercise meaningfully. Rather than
// adding jsdom as a new dependency, the same minimal in-memory localStorage
// stand-in already established in tests/leads.test.ts / tests/meta-
// ads.test.ts / tests/content-items.test.ts is installed on `globalThis
// .window` for that one suite, then torn down.

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

describe('getAutomationHealth', () => {
  it('is never_run when no run has happened yet', () => {
    expect(getAutomationHealth({ lastRunAt: null, lastRunStatus: null })).toBe('never_run');
  });

  it('is needs_attention when the last run failed', () => {
    expect(getAutomationHealth({ lastRunAt: '2026-01-01T00:00:00.000Z', lastRunStatus: 'failed' })).toBe(
      'needs_attention',
    );
  });

  it('is healthy when the last run succeeded', () => {
    expect(getAutomationHealth({ lastRunAt: '2026-01-01T00:00:00.000Z', lastRunStatus: 'success' })).toBe('healthy');
  });

  it('is healthy (not needs_attention) while the last run is still running', () => {
    expect(getAutomationHealth({ lastRunAt: '2026-01-01T00:00:00.000Z', lastRunStatus: 'running' })).toBe('healthy');
  });
});

describe('getAutomationRunStats', () => {
  const run = (status: AutomationRun['status']): AutomationRun => ({
    id: `run-${status}-${Math.random()}`,
    automationId: 'a1',
    status,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:00.000Z',
    summary: 'x',
    error: null,
    source: 'demo',
  });

  it('returns a null successRate — not zero — when there are no completed runs', () => {
    expect(getAutomationRunStats([])).toEqual({ totalRuns: 0, successfulRuns: 0, failedRuns: 0, successRate: null });
  });

  it('excludes in-flight running runs from the completed denominator', () => {
    const stats = getAutomationRunStats([run('running')]);
    expect(stats.totalRuns).toBe(1);
    expect(stats.successRate).toBeNull();
  });

  it('computes successRate over success + failed only', () => {
    const stats = getAutomationRunStats([run('success'), run('success'), run('failed'), run('running')]);
    expect(stats).toEqual({ totalRuns: 4, successfulRuns: 2, failedRuns: 1, successRate: 2 / 3 });
  });
});

describe('label helpers', () => {
  it('resolve known ids to human labels', () => {
    expect(getStatusLabel('active')).toBe('Activa');
    expect(getHealthLabel('needs_attention')).toBe('Requiere atención');
    expect(getPlatformLabel('google_sheets')).toBe('Google Sheets');
    expect(getTypeLabel('lead_response')).toBe('Respuesta a lead');
    expect(getRunStatusLabel('failed')).toBe('Fallido');
  });

  it('falls back to the raw id for an unrecognized value rather than throwing', () => {
    expect(getPlatformLabel('carrier_pigeon' as never)).toBe('carrier_pigeon');
  });
});

describe('platform enum', () => {
  it('contains exactly the controlled REKREATIVE platform set', () => {
    expect(AUTOMATION_PLATFORM_OPTIONS.map((o) => o.id)).toEqual([
      'make',
      'manychat',
      'whatsapp',
      'meta',
      'openai',
      'google_sheets',
      'calendar',
      'internal',
    ]);
  });
});

describe('server-side (no window) behavior', () => {
  it('initializeAutomationsStoreIfNeeded falls back to in-memory seed data', () => {
    const seeded = initializeAutomationsStoreIfNeeded();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((a) => a.dataSource === 'demo')).toBe(true);
  });

  it('createAutomation rejects a client id that cannot be found (client list is empty without window)', () => {
    expect(() =>
      createAutomation({
        clientId: 'client-does-not-exist',
        name: 'Test automation',
        type: 'other',
        platforms: ['internal'],
        trigger: { platform: 'internal', event: 'x', description: 'x' },
      }),
    ).toThrow('Cannot create automation for a missing client id');
  });

  it('createAutomation with scope internal succeeds without a window (no client lookup needed)', () => {
    const created = createAutomation({
      scope: 'internal',
      name: 'Internal, no window',
      type: 'other',
      platforms: ['internal'],
      trigger: { platform: 'internal', event: 'x', description: 'x' },
    });
    expect(created.scope).toBe('internal');
    expect(created.clientId).toBeNull();
  });
});

describe('getClientNameForAutomation', () => {
  it('returns Interno for a null clientId, never a fabricated client name', () => {
    expect(getClientNameForAutomation(null)).toBe('Interno');
  });
});

describe('CRUD + scope invariant (browser-like storage)', () => {
  beforeEach(() => {
    installBrowserLikeStorage();
    initializeClientsStoreIfNeeded();
    initializeAutomationsStoreIfNeeded();
  });

  afterEach(() => {
    uninstallBrowserLikeStorage();
  });

  it('seeds both REKREATIVE-internal and client automations, all with a scope field', () => {
    const automations = getAutomations();
    expect(automations.length).toBeGreaterThan(0);
    expect(automations.every((a) => a.scope === 'internal' || a.scope === 'client')).toBe(true);
    expect(automations.some((a) => a.scope === 'internal' && a.clientId === null)).toBe(true);
    expect(automations.some((a) => a.scope === 'client' && a.clientId != null)).toBe(true);
  });

  it('at least one internal automation has believable run history (not an empty default view)', () => {
    const internal = getAutomations().filter((a) => a.scope === 'internal');
    expect(internal.some((a) => getAutomationHealth(a) === 'healthy')).toBe(true);
  });

  it('a record persisted before `scope` existed normalizes to client on read, never dropped or crashed on', () => {
    // Simulate pre-migration data: an Automation row with no `scope` field
    // at all, exactly what JSON.parse yields for anything written before
    // this pass.
    const legacy = { ...getAutomations()[0] } as Partial<Automation>;
    delete (legacy as { scope?: unknown }).scope;
    window.localStorage.setItem('rek_automations_v1', JSON.stringify([legacy]));

    const [normalized] = getAutomations();
    expect(normalized.scope).toBe('client');
    expect(normalized.clientId).toBe(legacy.clientId);
  });

  it('createAutomation defaults to scope client when scope is omitted, preserving prior call-site behavior', () => {
    const created = createAutomation({
      clientId: 'client-acme',
      name: 'Legacy-style call',
      type: 'other',
      platforms: ['internal'],
      trigger: { platform: 'internal', event: 'x', description: 'x' },
    });
    expect(created.scope).toBe('client');
    expect(created.clientId).toBe('client-acme');
  });

  it('createAutomation persists a well-formed record for a real client', () => {
    const created = createAutomation({
      scope: 'client',
      clientId: 'client-acme',
      name: 'New client automation',
      type: 'other',
      platforms: ['internal'],
      trigger: { platform: 'internal', event: 'x', description: 'x' },
    });
    expect(created.id).toMatch(/^automation-/);
    expect(created.clientId).toBe('client-acme');
    expect(created.status).toBe('draft'); // default status
    expect(getAutomationById(created.id)).not.toBeNull();
  });

  it('createAutomation rejects scope client with no clientId', () => {
    expect(() =>
      createAutomation({
        scope: 'client',
        name: 'No client',
        type: 'other',
        platforms: ['internal'],
        trigger: { platform: 'internal', event: 'x', description: 'x' },
      }),
    ).toThrow('A client-scoped automation requires a clientId');
  });

  it('createAutomation rejects scope client with a clientId that does not exist', () => {
    expect(() =>
      createAutomation({
        scope: 'client',
        clientId: 'client-does-not-exist',
        name: 'Bad client',
        type: 'other',
        platforms: ['internal'],
        trigger: { platform: 'internal', event: 'x', description: 'x' },
      }),
    ).toThrow('Cannot create automation for a missing client id');
  });

  it('createAutomation forces clientId to null for scope internal even if one is passed', () => {
    const created = createAutomation({
      scope: 'internal',
      clientId: 'client-acme',
      name: 'Should not keep client',
      type: 'other',
      platforms: ['internal'],
      trigger: { platform: 'internal', event: 'x', description: 'x' },
    });
    expect(created.scope).toBe('internal');
    expect(created.clientId).toBeNull();
  });

  it('updateAutomation switching scope to internal clears clientId', () => {
    const created = createAutomation({
      scope: 'client',
      clientId: 'client-acme',
      name: 'Client automation',
      type: 'other',
      platforms: ['internal'],
      trigger: { platform: 'internal', event: 'x', description: 'x' },
    });
    const updated = updateAutomation(created.id, { scope: 'internal' });
    expect(updated?.scope).toBe('internal');
    expect(updated?.clientId).toBeNull();
  });

  it('updateAutomation switching scope to client without a valid clientId throws', () => {
    const created = createAutomation({
      scope: 'internal',
      name: 'Internal automation',
      type: 'other',
      platforms: ['internal'],
      trigger: { platform: 'internal', event: 'x', description: 'x' },
    });
    expect(() => updateAutomation(created.id, { scope: 'client', clientId: null })).toThrow(
      'A client-scoped automation requires a clientId',
    );
  });

  it('updateAutomation returns null for a missing id', () => {
    expect(updateAutomation('automation-does-not-exist', { name: 'x' })).toBeNull();
  });

  it(
    'getAutomations(clientId) returns only that client\'s automations — excludes internal and other clients ' +
      '(Client Workspace isolation)',
    () => {
      createAutomation({
        scope: 'client',
        clientId: 'client-acme',
        name: 'Acme automation',
        type: 'other',
        platforms: ['internal'],
        trigger: { platform: 'internal', event: 'x', description: 'x' },
      });
      createAutomation({
        scope: 'client',
        clientId: 'client-northwind',
        name: 'Northwind automation',
        type: 'other',
        platforms: ['internal'],
        trigger: { platform: 'internal', event: 'x', description: 'x' },
      });
      createAutomation({
        scope: 'internal',
        name: 'REKREATIVE internal automation',
        type: 'other',
        platforms: ['internal'],
        trigger: { platform: 'internal', event: 'x', description: 'x' },
      });

      const acmeAutomations = getAutomations('client-acme');
      expect(acmeAutomations.length).toBeGreaterThan(0);
      expect(acmeAutomations.every((a) => a.clientId === 'client-acme')).toBe(true);
      // The invariant this test exists to prove: scope === 'internal' /
      // clientId === null can never surface for a specific client id.
      expect(acmeAutomations.some((a) => a.scope === 'internal')).toBe(false);
      expect(acmeAutomations.some((a) => a.clientId === null)).toBe(false);
      expect(acmeAutomations.some((a) => a.clientId === 'client-northwind')).toBe(false);
    },
  );

  it('getAutomations() with no clientId includes both internal and client automations (scope filtering is the caller\'s job)', () => {
    createAutomation({
      scope: 'client',
      clientId: 'client-acme',
      name: 'Acme automation',
      type: 'other',
      platforms: ['internal'],
      trigger: { platform: 'internal', event: 'x', description: 'x' },
    });
    createAutomation({
      scope: 'internal',
      name: 'REKREATIVE internal automation',
      type: 'other',
      platforms: ['internal'],
      trigger: { platform: 'internal', event: 'x', description: 'x' },
    });

    const all = getAutomations();
    expect(all.some((a) => a.scope === 'internal')).toBe(true);
    expect(all.some((a) => a.scope === 'client')).toBe(true);
  });
});

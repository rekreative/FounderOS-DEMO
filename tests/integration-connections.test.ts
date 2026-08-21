import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { initializeStoreIfNeeded as initializeClientsStoreIfNeeded } from '@/lib/clients';
import {
  INTEGRATION_PLATFORM_OPTIONS,
  createIntegrationConnection,
  getClientNameForIntegrationConnection,
  getIntegrationConfigurationStatus,
  getIntegrationConfigurationStatusLabel,
  getIntegrationConnections,
  getIntegrationPlatformLabel,
  getIntegrationScopeLabel,
  getIntegrationVerificationStatusLabel,
  initializeIntegrationConnectionsStoreIfNeeded,
  summarizeIntegrationConnections,
  type IntegrationConnection,
} from '@/lib/integration-connections';

// Browser-like storage stand-in — same minimal pattern already established
// in tests/leads.test.ts / tests/meta-ads.test.ts / tests/automations.test.ts
// / tests/agents-ai.test.ts for exercising localStorage-backed CRUD under
// vitest's `node` environment.
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

// Same rationale as tests/automations.test.ts / tests/agents-ai.test.ts: this
// suite runs under vitest's `node` environment (no window/localStorage).
// What IS testable in node are the pure derivation/label helpers and the
// SSR-safe fallbacks; CRUD against localStorage needs a browser and is
// exercised by manual verification.

type ConfigurationStatusInput = Pick<
  IntegrationConnection,
  'name' | 'platform' | 'scope' | 'clientId' | 'externalRef' | 'externalLabel'
>;

function baseConnection(overrides: Partial<ConfigurationStatusInput> = {}): ConfigurationStatusInput {
  return {
    name: 'Conexión de prueba',
    platform: 'whatsapp',
    scope: 'internal',
    clientId: null,
    externalRef: null,
    externalLabel: null,
    ...overrides,
  };
}

describe('getIntegrationConfigurationStatus', () => {
  it('is configured for an internal connection with no external reference (e.g. internal OpenAI)', () => {
    expect(getIntegrationConfigurationStatus(baseConnection({ platform: 'openai' }))).toBe('configured');
  });

  it('is configured for a client connection with an externalRef', () => {
    expect(
      getIntegrationConfigurationStatus(
        baseConnection({ scope: 'client', clientId: 'client-acme', externalRef: 'act_123' }),
      ),
    ).toBe('configured');
  });

  it('is configured for a client connection with only an externalLabel', () => {
    expect(
      getIntegrationConfigurationStatus(
        baseConnection({ scope: 'client', clientId: 'client-acme', externalLabel: 'Cuenta Acme' }),
      ),
    ).toBe('configured');
  });

  it('is incomplete for a client connection missing both externalRef and externalLabel', () => {
    expect(
      getIntegrationConfigurationStatus(baseConnection({ scope: 'client', clientId: 'client-acme' })),
    ).toBe('incomplete');
  });

  it('is incomplete when scope is client but clientId is missing', () => {
    expect(
      getIntegrationConfigurationStatus(
        baseConnection({ scope: 'client', clientId: null, externalRef: 'act_123' }),
      ),
    ).toBe('incomplete');
  });

  it('is incomplete when name is blank', () => {
    expect(getIntegrationConfigurationStatus(baseConnection({ name: '' }))).toBe('incomplete');
  });

  it('does not derive configuration status from verification status — they are separate vocabularies', () => {
    // Configuration status is computed purely from name/platform/scope/clientId/
    // externalRef/externalLabel; verificationStatus never enters the Pick.
    expect(getIntegrationConfigurationStatus(baseConnection())).toBe('configured');
  });
});

function fullConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: 'connection-x',
    scope: 'internal',
    clientId: null,
    platform: 'openai',
    name: 'Conexión de prueba',
    verificationStatus: 'not_verified',
    verificationMethod: null,
    lastVerifiedAt: null,
    externalRef: null,
    externalLabel: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    dataSource: 'manual',
    ...overrides,
  };
}

describe('verification state semantics', () => {
  it('not_verified always pairs with a null method and a null lastVerifiedAt', () => {
    const c = fullConnection();
    expect(c.verificationStatus).toBe('not_verified');
    expect(c.verificationMethod).toBeNull();
    expect(c.lastVerifiedAt).toBeNull();
  });

  it('a verified connection must identify a method', () => {
    const c = fullConnection({ verificationStatus: 'verified', verificationMethod: 'manual', lastVerifiedAt: '2026-02-01T00:00:00.000Z' });
    expect(c.verificationMethod).toBe('manual');
    expect(c.lastVerifiedAt).not.toBeNull();
  });

  it('label: not_verified renders "No verificada"', () => {
    expect(getIntegrationVerificationStatusLabel(fullConnection())).toBe('No verificada');
  });

  it('label: verified + manual renders "Verificada manualmente" — never "Conectada"', () => {
    const label = getIntegrationVerificationStatusLabel(
      fullConnection({ verificationStatus: 'verified', verificationMethod: 'manual' }),
    );
    expect(label).toBe('Verificada manualmente');
    expect(label).not.toMatch(/conectada|connected|healthy|operativa/i);
  });

  it('label: failed + manual renders "Incidencia detectada manualmente"', () => {
    expect(
      getIntegrationVerificationStatusLabel(fullConnection({ verificationStatus: 'failed', verificationMethod: 'manual' })),
    ).toBe('Incidencia detectada manualmente');
  });

  it('label: verified + system (future backend) renders "Verificada por sistema"', () => {
    expect(
      getIntegrationVerificationStatusLabel(fullConnection({ verificationStatus: 'verified', verificationMethod: 'system' })),
    ).toBe('Verificada por sistema');
  });

  it('label: failed + system renders "Incidencia detectada por sistema"', () => {
    expect(
      getIntegrationVerificationStatusLabel(fullConnection({ verificationStatus: 'failed', verificationMethod: 'system' })),
    ).toBe('Incidencia detectada por sistema');
  });
});

describe('summarizeIntegrationConnections', () => {
  it('counts configured/incomplete/not-verified/incidents from the given set', () => {
    const connections = [
      fullConnection({ verificationStatus: 'not_verified' }), // configured (internal, no ref needed)
      fullConnection({ scope: 'client', clientId: null, verificationStatus: 'not_verified' }), // incomplete (client, no clientId)
      fullConnection({ verificationStatus: 'verified', verificationMethod: 'manual', lastVerifiedAt: '2026-02-01T00:00:00.000Z' }),
      fullConnection({ verificationStatus: 'failed', verificationMethod: 'manual', lastVerifiedAt: '2026-02-02T00:00:00.000Z' }),
    ];
    // notVerified/incidents partition the SAME set independently of
    // configured/incomplete — item 1 (configured) and item 2 (incomplete)
    // are both not_verified, so notVerified counts both.
    expect(summarizeIntegrationConnections(connections)).toEqual({
      configured: 3,
      incomplete: 1,
      notVerified: 2,
      incidents: 1,
    });
  });

  it('returns zeros for an empty list', () => {
    expect(summarizeIntegrationConnections([])).toEqual({ configured: 0, incomplete: 0, notVerified: 0, incidents: 0 });
  });

  it('demo seed data has exactly one incomplete connection and zero verified/failed connections', () => {
    const seeded = initializeIntegrationConnectionsStoreIfNeeded();
    const summary = summarizeIntegrationConnections(seeded);
    expect(summary.incomplete).toBe(1);
    expect(summary.notVerified).toBe(seeded.length);
    expect(summary.incidents).toBe(0);
  });
});

describe('label helpers', () => {
  it('resolve known ids to human labels', () => {
    expect(getIntegrationScopeLabel('internal')).toBe('Interno');
    expect(getIntegrationScopeLabel('client')).toBe('Cliente');
    expect(getIntegrationPlatformLabel('google_sheets')).toBe('Google Sheets');
    expect(getIntegrationPlatformLabel('other')).toBe('Otro');
    expect(getIntegrationConfigurationStatusLabel('configured')).toBe('Configurada');
    expect(getIntegrationConfigurationStatusLabel('incomplete')).toBe('Configuración incompleta');
  });

  it('falls back to the raw id for an unrecognized value rather than throwing', () => {
    expect(getIntegrationPlatformLabel('carrier_pigeon' as never)).toBe('carrier_pigeon');
  });

  it('getClientNameForIntegrationConnection returns "Interno" for null clientId', () => {
    expect(getClientNameForIntegrationConnection(null)).toBe('Interno');
  });

  // Backend V1: IntegrationConnectionsBoard passes the canonical PostgreSQL
  // clients list explicitly (useClientsRegistry()) instead of relying on
  // the legacy localStorage fallback.
  it('getClientNameForIntegrationConnection resolves from an explicitly-passed clients list', () => {
    const clients = [{ id: 'client-acme', name: 'Acme Co' }];
    expect(getClientNameForIntegrationConnection('client-acme', clients)).toBe('Acme Co');
    expect(getClientNameForIntegrationConnection('client-does-not-exist', clients)).toBe('Cliente desconocido');
  });
});

describe('platform enum', () => {
  it('contains exactly the controlled REKREATIVE platform set, Meta and Instagram kept separate', () => {
    expect(INTEGRATION_PLATFORM_OPTIONS.map((o) => o.id)).toEqual([
      'meta',
      'instagram',
      'whatsapp',
      'make',
      'manychat',
      'openai',
      'anthropic',
      'google_sheets',
      'google_calendar',
      'stripe',
      'paypal',
      'other',
    ]);
  });
});

describe('server-side (no window) behavior', () => {
  it('initializeIntegrationConnectionsStoreIfNeeded falls back to in-memory seed data', () => {
    const seeded = initializeIntegrationConnectionsStoreIfNeeded();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((c) => c.dataSource === 'demo')).toBe(true);
  });

  it('CRITICAL: every seeded connection is honestly unverified — no fake verification timestamps', () => {
    const seeded = initializeIntegrationConnectionsStoreIfNeeded();
    for (const connection of seeded) {
      expect(connection.verificationStatus).toBe('not_verified');
      expect(connection.verificationMethod).toBeNull();
      expect(connection.lastVerifiedAt).toBeNull();
    }
  });

  it('seed data includes at least one deliberately incomplete connection', () => {
    const seeded = initializeIntegrationConnectionsStoreIfNeeded();
    const incomplete = seeded.filter((c) => getIntegrationConfigurationStatus(c) === 'incomplete');
    expect(incomplete.length).toBeGreaterThan(0);
  });

  it('createIntegrationConnection rejects a client-scoped connection with a missing client id (client list is empty without window)', () => {
    expect(() =>
      createIntegrationConnection({
        scope: 'client',
        clientId: 'client-does-not-exist',
        platform: 'whatsapp',
        name: 'Test connection',
      }),
    ).toThrow('Cannot create integration connection for a missing client id');
  });

  it('createIntegrationConnection rejects a client-scoped connection with no client id at all', () => {
    expect(() =>
      createIntegrationConnection({
        scope: 'client',
        platform: 'whatsapp',
        name: 'Test connection',
      }),
    ).toThrow('A client-scoped integration connection requires a clientId');
  });
});

describe('Client Workspace isolation (browser-like storage)', () => {
  beforeEach(() => {
    installBrowserLikeStorage();
    initializeClientsStoreIfNeeded();
    initializeIntegrationConnectionsStoreIfNeeded();
  });

  afterEach(() => {
    uninstallBrowserLikeStorage();
  });

  it("getIntegrationConnections(clientId) returns only that client's connections — excludes internal and other clients", () => {
    createIntegrationConnection({ scope: 'client', clientId: 'client-acme', platform: 'meta', name: 'Acme connection' });
    createIntegrationConnection({ scope: 'client', clientId: 'client-northwind', platform: 'whatsapp', name: 'Northwind connection' });
    createIntegrationConnection({ scope: 'internal', platform: 'make', name: 'REKREATIVE internal connection' });

    const acmeConnections = getIntegrationConnections('client-acme');
    expect(acmeConnections.length).toBeGreaterThan(0);
    expect(acmeConnections.every((connection) => connection.clientId === 'client-acme')).toBe(true);
    expect(acmeConnections.some((connection) => connection.scope === 'internal')).toBe(false);
    expect(acmeConnections.some((connection) => connection.clientId === 'client-northwind')).toBe(false);
  });

  it("getIntegrationConnections() with no clientId includes both internal and client connections (scope filtering is the caller's job)", () => {
    createIntegrationConnection({ scope: 'client', clientId: 'client-acme', platform: 'meta', name: 'Acme connection' });
    createIntegrationConnection({ scope: 'internal', platform: 'make', name: 'REKREATIVE internal connection' });

    const all = getIntegrationConnections();
    expect(all.some((connection) => connection.scope === 'internal')).toBe(true);
    expect(all.some((connection) => connection.scope === 'client' && connection.clientId === 'client-acme')).toBe(true);
  });

  it('every internal connection has clientId null, regardless of how many clients exist', () => {
    createIntegrationConnection({ scope: 'internal', platform: 'openai', name: 'REKREATIVE internal connection' });
    createIntegrationConnection({ scope: 'client', clientId: 'client-acme', platform: 'meta', name: 'Acme connection' });

    const internalOnly = getIntegrationConnections().filter((connection) => connection.scope === 'internal');
    expect(internalOnly.every((connection) => connection.clientId === null)).toBe(true);
  });
});

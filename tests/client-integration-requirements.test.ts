import { describe, it, expect } from 'vitest';
import {
  buildClientRequirementRows,
  computeRequirementInitialization,
  getIntegrationRequirementLevelLabel,
  getRequirementConnectionScopeLabel,
  getRequirementStateLabel,
  initializeClientIntegrationRequirementsStoreIfNeeded,
  normalizeRequirement,
  seedDefaultRequirementsForClient,
  summarizeClientOnboarding,
  setClientIntegrationRequirement,
  type ClientIntegrationRequirement,
} from '@/lib/client-integration-requirements';
import {
  getIntegrationPlatformLabel,
  initializeIntegrationConnectionsStoreIfNeeded,
  type IntegrationConnection,
} from '@/lib/integration-connections';

// Same rationale as tests/integration-connections.test.ts: this suite runs
// under vitest's `node` environment (no window/localStorage). What IS
// testable in node are the pure derivation/label helpers and the SSR-safe
// fallbacks; CRUD against localStorage needs a browser and is exercised by
// manual verification.

function requirement(overrides: Partial<ClientIntegrationRequirement> = {}): ClientIntegrationRequirement {
  return {
    id: 'req-x',
    clientId: 'client-acme',
    platform: 'meta',
    requirement: 'required',
    connectionScope: 'client',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function connection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: 'connection-x',
    scope: 'client',
    clientId: 'client-acme',
    platform: 'meta',
    name: 'Conexión de prueba',
    verificationStatus: 'not_verified',
    verificationMethod: null,
    lastVerifiedAt: null,
    externalRef: 'act_123',
    externalLabel: 'Cuenta de prueba',
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    dataSource: 'manual',
    ...overrides,
  };
}

describe('buildClientRequirementRows — client-scope matching', () => {
  it('a required platform with no matching connection is pending', () => {
    const rows = buildClientRequirementRows([requirement()], []);
    expect(rows).toEqual([{ platform: 'meta', requirement: 'required', connectionScope: 'client', connection: null, state: 'pending' }]);
  });

  it('a required platform with an incomplete connection stays incomplete, not configured', () => {
    // scope client with no externalRef/externalLabel => incomplete, per
    // getIntegrationConfigurationStatus in lib/integration-connections.ts
    const incompleteConnection = connection({ externalRef: null, externalLabel: null });
    const rows = buildClientRequirementRows([requirement()], [incompleteConnection]);
    expect(rows[0].state).toBe('incomplete');
    expect(rows[0].connection).toBe(incompleteConnection);
  });

  it('a required platform with a configured connection is configured', () => {
    const rows = buildClientRequirementRows([requirement()], [connection()]);
    expect(rows[0].state).toBe('configured');
  });

  it('a client-scope requirement matches only a connection owned by that same client, ignoring other clients', () => {
    const rows = buildClientRequirementRows(
      [requirement({ clientId: 'client-acme', platform: 'meta', connectionScope: 'client' })],
      [connection({ clientId: 'client-northwind', platform: 'meta' }), connection({ clientId: 'client-acme', platform: 'whatsapp' })],
    );
    expect(rows[0].state).toBe('pending');
    expect(rows[0].connection).toBeNull();
  });
});

describe('buildClientRequirementRows — internal/shared-scope matching', () => {
  it('an internal-scope requirement is satisfied by ANY internal connection for that platform, regardless of clientId', () => {
    const sharedMake = connection({ scope: 'internal', clientId: null, platform: 'make', name: 'Make — Workspace REKREATIVE' });
    const rows = buildClientRequirementRows(
      [requirement({ clientId: 'client-acme', platform: 'make', requirement: 'required', connectionScope: 'internal' })],
      [sharedMake],
    );
    expect(rows[0].connection).toBe(sharedMake);
    expect(rows[0].state).toBe('configured');
  });

  it('a shared internal OpenAI connection satisfies an internal-scope requirement too, even with no external reference (internal bypasses that check)', () => {
    const sharedOpenAI = connection({
      scope: 'internal',
      clientId: null,
      platform: 'openai',
      externalRef: null,
      externalLabel: null,
      name: 'OpenAI — REKREATIVE',
    });
    const rows = buildClientRequirementRows(
      [requirement({ platform: 'openai', requirement: 'required', connectionScope: 'internal' })],
      [sharedOpenAI],
    );
    expect(rows[0].state).toBe('configured');
  });

  it('a client-owned connection does NOT satisfy an internal-scope requirement', () => {
    const clientOwnedMake = connection({ scope: 'client', clientId: 'client-acme', platform: 'make' });
    const rows = buildClientRequirementRows(
      [requirement({ clientId: 'client-acme', platform: 'make', connectionScope: 'internal' })],
      [clientOwnedMake],
    );
    expect(rows[0].connection).toBeNull();
    expect(rows[0].state).toBe('pending');
  });

  it('an internal connection does NOT satisfy a client-scope requirement', () => {
    const sharedMake = connection({ scope: 'internal', clientId: null, platform: 'make' });
    const rows = buildClientRequirementRows(
      [requirement({ clientId: 'client-acme', platform: 'make', connectionScope: 'client' })],
      [sharedMake],
    );
    expect(rows[0].connection).toBeNull();
    expect(rows[0].state).toBe('pending');
  });
});

describe('pending vs "no añadida" semantics', () => {
  it('required + no connection derives raw state "pending", labeled Pendiente', () => {
    const rows = buildClientRequirementRows([requirement({ requirement: 'required' })], []);
    expect(rows[0].state).toBe('pending');
    expect(getRequirementStateLabel(rows[0].state, rows[0].requirement)).toBe('Pendiente');
  });

  it('optional + no connection derives the SAME raw state "pending", but is labeled "No añadida", never "Pendiente"', () => {
    const rows = buildClientRequirementRows([requirement({ requirement: 'optional' })], []);
    expect(rows[0].state).toBe('pending');
    expect(getRequirementStateLabel(rows[0].state, rows[0].requirement)).toBe('No añadida');
  });

  it('a missing OPTIONAL platform is never counted toward requiredPending or requiredTotal', () => {
    const summary = summarizeClientOnboarding('client-acme', [requirement({ requirement: 'optional' })], []);
    expect(summary.requiredTotal).toBe(0);
    expect(summary.requiredPending).toBe(0);
  });

  it('a missing REQUIRED platform IS counted toward requiredPending', () => {
    const summary = summarizeClientOnboarding('client-acme', [requirement({ requirement: 'required' })], []);
    expect(summary.requiredTotal).toBe(1);
    expect(summary.requiredPending).toBe(1);
  });
});

describe('summarizeClientOnboarding', () => {
  it('counts required-only: configured, pending, incomplete', () => {
    const requirements = [
      requirement({ platform: 'meta', requirement: 'required' }),
      requirement({ platform: 'whatsapp', requirement: 'required' }),
      requirement({ platform: 'make', requirement: 'required', connectionScope: 'internal' }),
    ];
    const connections = [
      connection({ platform: 'meta' }), // configured
      connection({ platform: 'whatsapp', externalRef: null, externalLabel: null }), // incomplete
      // 'make' (internal-scope) has no internal connection at all => pending
    ];
    const summary = summarizeClientOnboarding('client-acme', requirements, connections);
    expect(summary.requiredTotal).toBe(3);
    expect(summary.requiredConfigured).toBe(1);
    expect(summary.requiredIncomplete).toBe(1);
    expect(summary.requiredPending).toBe(1);
    expect(summary.progressPercent).toBe(33); // 1/3 rounded
  });

  it('optional integrations never reduce required progress, configured or not', () => {
    const requirements = [
      requirement({ platform: 'meta', requirement: 'required' }),
      requirement({ platform: 'instagram', requirement: 'optional' }), // no connection at all
      requirement({ platform: 'stripe', requirement: 'optional' }), // no connection at all
    ];
    const connections = [connection({ platform: 'meta' })]; // the one required platform, configured
    const summary = summarizeClientOnboarding('client-acme', requirements, connections);
    expect(summary.requiredTotal).toBe(1);
    expect(summary.requiredConfigured).toBe(1);
    expect(summary.progressPercent).toBe(100);
  });

  it('progressPercent is null (never a fake 0%/100%) when there are zero required platforms', () => {
    const requirements = [requirement({ platform: 'instagram', requirement: 'optional' })];
    const summary = summarizeClientOnboarding('client-acme', requirements, []);
    expect(summary.requiredTotal).toBe(0);
    expect(summary.progressPercent).toBeNull();
  });

  it('a shared internal Make connection satisfies a required internal-scope requirement toward progress', () => {
    const requirements = [requirement({ platform: 'make', requirement: 'required', connectionScope: 'internal' })];
    const connections = [connection({ scope: 'internal', clientId: null, platform: 'make' })];
    const summary = summarizeClientOnboarding('client-acme', requirements, connections);
    expect(summary.requiredConfigured).toBe(1);
    expect(summary.progressPercent).toBe(100);
  });

  it('a shared internal OpenAI connection satisfies a required internal-scope requirement toward progress', () => {
    const requirements = [requirement({ platform: 'openai', requirement: 'required', connectionScope: 'internal' })];
    const connections = [connection({ scope: 'internal', clientId: null, platform: 'openai', externalRef: null, externalLabel: null })];
    const summary = summarizeClientOnboarding('client-acme', requirements, connections);
    expect(summary.requiredConfigured).toBe(1);
  });

  it('incidents counts only connections actually matched to one of this client\'s requirement rows (client-owned or shared)', () => {
    const requirements = [
      requirement({ platform: 'meta', requirement: 'required', connectionScope: 'client' }),
      requirement({ platform: 'make', requirement: 'required', connectionScope: 'internal' }),
    ];
    const connections = [
      connection({ platform: 'meta', verificationStatus: 'failed', verificationMethod: 'manual', lastVerifiedAt: '2026-02-01T00:00:00.000Z' }),
      connection({ scope: 'internal', clientId: null, platform: 'make', verificationStatus: 'failed', verificationMethod: 'manual', lastVerifiedAt: '2026-02-01T00:00:00.000Z' }),
      // An internal incident on a platform this client has NO requirement for must never leak in.
      connection({ scope: 'internal', clientId: null, platform: 'openai', verificationStatus: 'failed', verificationMethod: 'manual', lastVerifiedAt: '2026-02-01T00:00:00.000Z' }),
    ];
    const summary = summarizeClientOnboarding('client-acme', requirements, connections);
    expect(summary.incidents).toBe(2);
  });
});

describe('Acme default onboarding summary against the real seeded demo data', () => {
  it('is 4/5 required configured, 80%, 1 pendiente — Meta and Google Sheets client-owned, Make and OpenAI satisfied by REKREATIVE\'s shared connections, WhatsApp missing', () => {
    const allRequirements = initializeClientIntegrationRequirementsStoreIfNeeded();
    const allConnections = initializeIntegrationConnectionsStoreIfNeeded();
    const acmeRequirements = allRequirements.filter((r) => r.clientId === 'client-acme');
    const internalConnections = allConnections.filter((c) => c.scope === 'internal');
    const acmeConnections = allConnections.filter((c) => c.clientId === 'client-acme');

    const summary = summarizeClientOnboarding('client-acme', acmeRequirements, [...acmeConnections, ...internalConnections]);

    expect(summary.requiredTotal).toBe(5);
    expect(summary.requiredConfigured).toBe(4);
    expect(summary.requiredPending).toBe(1);
    expect(summary.progressPercent).toBe(80);
  });
});

describe('computeRequirementInitialization — bug fix: a client newly created through /clients must be seeded automatically', () => {
  it('an arbitrary newly-created client (no hardcoded id) receives the full template exactly once', () => {
    const dynamicClientId = 'client-whatever-was-just-created-in-the-ui';
    const { newRows, initializedClientIds } = computeRequirementInitialization([], [], [dynamicClientId]);

    expect(newRows).toHaveLength(11); // 5 required + 6 optional
    expect(newRows.every((row) => row.clientId === dynamicClientId)).toBe(true);
    expect(newRows.filter((row) => row.requirement === 'required')).toHaveLength(5);
    expect(newRows.filter((row) => row.requirement === 'optional')).toHaveLength(6);
    expect(initializedClientIds).toEqual([dynamicClientId]);
  });

  it('a second run for the same client (now marked initialized) adds nothing — idempotent', () => {
    const dynamicClientId = 'client-second-run-idempotency-check';
    const first = computeRequirementInitialization([], [], [dynamicClientId]);
    const second = computeRequirementInitialization(first.newRows, first.initializedClientIds, [dynamicClientId]);

    expect(second.newRows).toHaveLength(0);
    expect(second.initializedClientIds).toEqual([dynamicClientId]);
  });

  it('a platform the user set to "No usada" (removed) stays removed after re-initialization', () => {
    const dynamicClientId = 'client-no-usada-check';
    const first = computeRequirementInitialization([], [], [dynamicClientId]);
    // User removes 'stripe' via setClientIntegrationRequirement(..., null) — simulated here by filtering it out.
    const afterRemoval = first.newRows.filter((row) => row.platform !== 'stripe');

    const second = computeRequirementInitialization(afterRemoval, first.initializedClientIds, [dynamicClientId]);

    expect(second.newRows).toHaveLength(0); // stripe is NOT recreated
    expect(afterRemoval.some((row) => row.platform === 'stripe')).toBe(false);
  });

  it('a custom required<->optional change survives re-initialization', () => {
    const dynamicClientId = 'client-custom-level-check';
    const first = computeRequirementInitialization([], [], [dynamicClientId]);
    const customized = first.newRows.map((row) => (row.platform === 'meta' ? { ...row, requirement: 'optional' as const } : row));

    const second = computeRequirementInitialization(customized, first.initializedClientIds, [dynamicClientId]);

    expect(second.newRows).toHaveLength(0);
    expect(customized.find((row) => row.platform === 'meta')?.requirement).toBe('optional'); // not reset back to required
  });

  it('migration safety: a client with existing rows but no initialized-id entry yet (predates this tracking) is marked initialized WITHOUT touching or duplicating their rows', () => {
    const preExistingClientId = 'client-predates-tracking';
    const preExistingRows = seedDefaultRequirementsForClient(preExistingClientId).filter((row) => row.platform !== 'anthropic'); // already customized before this fix shipped

    const result = computeRequirementInitialization(preExistingRows, [], [preExistingClientId]);

    expect(result.newRows).toHaveLength(0); // nothing added, nothing duplicated
    expect(result.initializedClientIds).toEqual([preExistingClientId]);
  });

  it('"Test onboarding": a dynamic client with no connections of its own resolves to 2/5 required configured, 40%, 3 pendientes, via REKREATIVE\'s shared Make/OpenAI connections', () => {
    const dynamicClientId = 'client-test-onboarding';
    const { newRows: requirements } = computeRequirementInitialization([], [], [dynamicClientId]);

    const allConnections = initializeIntegrationConnectionsStoreIfNeeded();
    const internalConnections = allConnections.filter((c) => c.scope === 'internal');
    // This client owns no IntegrationConnection records of its own yet.

    const summary = summarizeClientOnboarding(dynamicClientId, requirements, internalConnections);

    expect(summary.requiredTotal).toBe(5);
    expect(summary.requiredConfigured).toBe(2); // Make + OpenAI, satisfied by REKREATIVE's shared internal connections
    expect(summary.requiredPending).toBe(3); // Meta, WhatsApp, Google Sheets — no client-owned connection
    expect(summary.progressPercent).toBe(40);
    // Optional platforms (Instagram, ManyChat, Google Calendar, Stripe, PayPal, Anthropic) never touch this number.
  });

  it('initializeClientIntegrationRequirementsStoreIfNeeded is what invokes this — no second competing entry point', () => {
    // Server-side (no window), it falls back to the historical hardcoded-id
    // demo seed rather than computeRequirementInitialization, since
    // getClients() has nothing to iterate without a browser — this is the
    // one function the Integrations board calls on every mount either way.
    expect(typeof initializeClientIntegrationRequirementsStoreIfNeeded).toBe('function');
  });
});

describe('label helpers', () => {
  it('resolve known ids to human labels', () => {
    expect(getIntegrationRequirementLevelLabel('required')).toBe('Requerida');
    expect(getIntegrationRequirementLevelLabel('optional')).toBe('Opcional');
    expect(getRequirementConnectionScopeLabel('client')).toBe('Cliente');
    expect(getRequirementConnectionScopeLabel('internal')).toBe('REKREATIVE Compartida');
    expect(getRequirementStateLabel('incomplete')).toBe('Configuración incompleta');
    expect(getRequirementStateLabel('configured')).toBe('Configurada');
  });

  it('getRequirementStateLabel defaults its requirement argument to "required" (bare one-argument call keeps prior meaning)', () => {
    expect(getRequirementStateLabel('pending')).toBe('Pendiente');
  });

  it('falls back to the raw id for an unrecognized value rather than throwing', () => {
    expect(getRequirementStateLabel('carrier_pigeon' as never)).toBe('carrier_pigeon');
  });

  it('Stripe and PayPal resolve through the shared platform label helper', () => {
    expect(getIntegrationPlatformLabel('stripe')).toBe('Stripe');
    expect(getIntegrationPlatformLabel('paypal')).toBe('PayPal');
  });
});

describe('connectionScope migration for legacy rows (normalizeRequirement)', () => {
  it('backfills connectionScope deterministically per platform for a row persisted before the field existed', () => {
    const legacyMakeRow = {
      id: 'req-legacy-make',
      clientId: 'client-acme',
      platform: 'make',
      requirement: 'required',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as ClientIntegrationRequirement; // simulates JSON.parse of a pre-migration row: connectionScope is absent, not just falsy
    const normalized = normalizeRequirement(legacyMakeRow);
    expect(normalized.connectionScope).toBe('internal');
    // Nothing else about the row changes — customization (level, ids, timestamps) survives untouched.
    expect(normalized.requirement).toBe('required');
    expect(normalized.id).toBe('req-legacy-make');
  });

  it('a client-owned platform like Meta migrates to connectionScope "client"', () => {
    const legacyMetaRow = {
      id: 'req-legacy-meta',
      clientId: 'client-acme',
      platform: 'meta',
      requirement: 'optional',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as ClientIntegrationRequirement;
    expect(normalizeRequirement(legacyMetaRow).connectionScope).toBe('client');
  });

  it('leaves an already-normalized row untouched (idempotent)', () => {
    const row = requirement({ connectionScope: 'internal' });
    expect(normalizeRequirement(row)).toEqual(row);
  });
});

describe('server-side (no window) behavior', () => {
  it('initializeClientIntegrationRequirementsStoreIfNeeded falls back to in-memory seed data', () => {
    const seeded = initializeClientIntegrationRequirementsStoreIfNeeded();
    expect(seeded.length).toBeGreaterThan(0);
  });

  it('default seeded template: 3 demo clients x (5 required + 6 optional) = 33 rows', () => {
    const seeded = initializeClientIntegrationRequirementsStoreIfNeeded();
    expect(seeded).toHaveLength(33);
    const byClient = new Map<string, ClientIntegrationRequirement[]>();
    for (const row of seeded) byClient.set(row.clientId, [...(byClient.get(row.clientId) ?? []), row]);
    expect([...byClient.keys()].sort()).toEqual(['client-acme', 'client-lumen', 'client-northwind']);
    for (const rows of byClient.values()) {
      expect(rows.filter((r) => r.requirement === 'required')).toHaveLength(5);
      expect(rows.filter((r) => r.requirement === 'optional')).toHaveLength(6);
    }
  });

  it('seeded rows carry the correct connectionScope per platform — Make/OpenAI shared, everything else client-owned (Anthropic is the one optional shared platform)', () => {
    const seeded = initializeClientIntegrationRequirementsStoreIfNeeded();
    const scopeByPlatform = new Map(seeded.map((r) => [r.platform, r.connectionScope]));
    expect(scopeByPlatform.get('make')).toBe('internal');
    expect(scopeByPlatform.get('openai')).toBe('internal');
    expect(scopeByPlatform.get('anthropic')).toBe('internal');
    expect(scopeByPlatform.get('meta')).toBe('client');
    expect(scopeByPlatform.get('whatsapp')).toBe('client');
    expect(scopeByPlatform.get('google_sheets')).toBe('client');
    expect(scopeByPlatform.get('instagram')).toBe('client');
    expect(scopeByPlatform.get('manychat')).toBe('client');
    expect(scopeByPlatform.get('google_calendar')).toBe('client');
    expect(scopeByPlatform.get('stripe')).toBe('client');
    expect(scopeByPlatform.get('paypal')).toBe('client');
  });

  it('setClientIntegrationRequirement rejects a missing client id (client list is empty without window)', () => {
    expect(() => setClientIntegrationRequirement('client-does-not-exist', 'meta', 'required')).toThrow(
      'Cannot set an integration requirement for a missing client id',
    );
  });
});

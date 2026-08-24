import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { appendCommercialEvent, appendWhatsAppEvent, createLead, ingestLeadTransactional } from '@/lib/server/leads-repo';
import { getClientOpsSnapshot, getOpsSnapshot } from '@/lib/server/ops-status';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

// Integration tests against the operator's real local dev PostgreSQL —
// exercises the Real V1 passive-evidence layer end to end. Skips cleanly
// when no DATABASE_URL is configured (see tests/helpers/pg-test-env.ts).
const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('lib/server/ops-status (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const createdLeadIds: string[] = [];

  async function makeClient(overrides: Partial<Parameters<typeof createClient>[0]> = {}) {
    const client = await createClient({
      name: 'Ops Status Test Client',
      sector: 'Testing',
      status: 'prospect',
      service: 'Ops status fixture',
      metaBudgetMonthly: 0,
      startDate: '2026-01-01',
      owner: 'test-suite',
      ...overrides,
    });
    createdClientIds.push(client.id);
    return client;
  }

  afterEach(async () => {
    const leadIds = createdLeadIds.splice(0);
    if (leadIds.length > 0) {
      await query('DELETE FROM lead_events WHERE lead_id = ANY($1)', [leadIds]);
      await query('DELETE FROM leads WHERE id = ANY($1)', [leadIds]);
    }
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE client_id = $1)', [id]);
      await query('DELETE FROM leads WHERE client_id = $1', [id]);
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    await closePool();
  });

  it('reports PostgreSQL operational when DATABASE_URL is configured and SELECT 1 succeeds, and never leaks secret values', async () => {
    const snapshot = await getOpsSnapshot();
    expect(snapshot.postgres.status).toBe('operational');
    const serialized = JSON.stringify(snapshot);

    // No connection string.
    expect(serialized).not.toContain(TEST_DATABASE_URL);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//i);

    // No actual secret VALUE. These vars are normally unset in the Vitest
    // process even when .env.local has them (see tests/helpers/pg-test-env.ts
    // — Vitest deliberately never loads non-DATABASE_URL creds), but this
    // guards the real thing defensively in case that ever changes. The
    // literal key NAMES (INGEST_API_KEY / MAKE_EVENTS_API_KEY) are safe,
    // human-readable operational copy explaining what's missing — see
    // lib/server/ops-status.ts's attention text — and must never be banned
    // outright; only their VALUES would be a leak.
    if (process.env.INGEST_API_KEY) expect(serialized).not.toContain(process.env.INGEST_API_KEY);
    if (process.env.MAKE_EVENTS_API_KEY) expect(serialized).not.toContain(process.env.MAKE_EVENTS_API_KEY);

    // No key/token/secret/credential-VALUE-bearing property anywhere in the
    // response shape — a structural check on property NAMES, never a
    // substring ban on safe diagnostic text.
    const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential)$/i;
    const assertNoSecretKeys = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(assertNoSecretKeys);
      } else if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
          expect(SECRET_KEY_PATTERN.test(key)).toBe(false);
          assertNoSecretKeys(nested);
        }
      }
    };
    assertNoSecretKeys(snapshot);
  });

  it('a Meta-originated lead ingestion produces activity_observed evidence for lead intake and the Meta Ads connection', async () => {
    const client = await makeClient();
    const result = await ingestLeadTransactional({
      scope: 'client',
      clientId: client.id,
      name: 'Meta Evidence Lead',
      deliveryId: `delivery-${Date.now()}-meta`,
      ingestionSource: 'meta',
      externalLeadId: `meta-${Date.now()}`,
    });
    createdLeadIds.push(result.lead.id);

    const snapshot = await getOpsSnapshot();
    const leadIntake = snapshot.automations.find((a) => a.id === 'lead_intake')!;
    expect(leadIntake.status).toBe('activity_observed');
    expect(leadIntake.lastActivityAt).not.toBeNull();
    expect(leadIntake.clients.some((c) => c.clientId === client.id)).toBe(true);

    const metaConnection = snapshot.connections.find((c) => c.id === 'meta_ads')!;
    expect(metaConnection.status).toBe('activity_observed');
  });

  it('a manually-created lead (no ingestionSource=meta) is never attributed as Meta evidence', async () => {
    const client = await makeClient();
    const { lead } = await createLead({ scope: 'client', clientId: client.id, name: 'Manual Lead, not Meta' });
    createdLeadIds.push(lead.id);

    const snapshot = await getOpsSnapshot();
    const leadIntake = snapshot.automations.find((a) => a.id === 'lead_intake')!;
    expect(leadIntake.clients.find((c) => c.clientId === client.id)).toBeUndefined();
  });

  it('ai_analyzed evidence drives both the qualification workflow and the Lead Qualification Agent, never claiming a specific model', async () => {
    const client = await makeClient();
    const result = await ingestLeadTransactional({
      scope: 'client',
      clientId: client.id,
      name: 'Qualification Evidence Lead',
      deliveryId: `delivery-${Date.now()}-qual`,
      ingestionSource: 'meta',
      externalLeadId: `meta-qual-${Date.now()}`,
      aiAnalysis: { summary: 'Qualified lead', intent: 'hot', priority: 'high', qualification: null, analyzedAt: null },
    });
    createdLeadIds.push(result.lead.id);

    const snapshot = await getOpsSnapshot();
    const qualification = snapshot.automations.find((a) => a.id === 'lead_qualification')!;
    expect(qualification.status).toBe('activity_observed');
    expect(qualification.clients.some((c) => c.clientId === client.id)).toBe(true);

    expect(snapshot.agent.status).toBe('activity_observed');
    expect(snapshot.agent.clients.some((c) => c.clientId === client.id)).toBe(true);
    expect(JSON.stringify(snapshot.agent)).not.toMatch(/gpt-4o|claude-sonnet/i);
  });

  it('no ai_analyzed evidence is a neutral configured/not_configured state, never an error', async () => {
    const client = await makeClient();
    const { lead } = await createLead({ scope: 'client', clientId: client.id, name: 'Never Qualified Lead' });
    createdLeadIds.push(lead.id);

    const snapshot = await getOpsSnapshot();
    // Global aggregate — other fixtures in this run may already have
    // qualification evidence, so only assert the neutral-not-error rule.
    expect(snapshot.agent.status).not.toBe('needs_attention');
    const qualification = snapshot.automations.find((a) => a.id === 'lead_qualification')!;
    expect(qualification.status).not.toBe('needs_attention');
  });

  it('whatsapp_sent and lead_replied produce activity_observed evidence for both WhatsApp workflows and the WhatsApp connection', async () => {
    const client = await makeClient();
    const phone = `+3460011${Math.floor(Math.random() * 9000 + 1000)}`;
    const { lead } = await createLead({ scope: 'client', clientId: client.id, name: 'WhatsApp Evidence Lead', whatsapp: phone });
    createdLeadIds.push(lead.id);

    await appendWhatsAppEvent({
      leadId: lead.id,
      type: 'whatsapp_sent',
      source: 'make',
      externalEventId: `wa-sent-${Date.now()}`,
      summary: 'Welcome template sent',
    });
    await appendWhatsAppEvent({
      whatsappNumber: phone,
      type: 'lead_replied',
      source: 'whatsapp',
      externalEventId: `wa-reply-${Date.now()}`,
      summary: 'Lead replied',
    });

    const snapshot = await getOpsSnapshot();
    const outbound = snapshot.automations.find((a) => a.id === 'whatsapp_outbound')!;
    const inbound = snapshot.automations.find((a) => a.id === 'whatsapp_inbound')!;
    expect(outbound.status).toBe('activity_observed');
    expect(inbound.status).toBe('activity_observed');
    expect(outbound.clients.some((c) => c.clientId === client.id)).toBe(true);
    expect(inbound.clients.some((c) => c.clientId === client.id)).toBe(true);

    const whatsappConnection = snapshot.connections.find((c) => c.id === 'whatsapp')!;
    expect(whatsappConnection.status).toBe('activity_observed');
  });

  it('commercial lifecycle evidence counts a Make-sourced event', async () => {
    const client = await makeClient();
    const { lead } = await createLead({ scope: 'client', clientId: client.id, name: 'Make Commercial Lead' });
    createdLeadIds.push(lead.id);

    await appendCommercialEvent({
      leadId: lead.id,
      type: 'appointment_booked',
      source: 'make',
      summary: 'Booked by Make',
      appointmentDate: '2026-09-01T10:00:00.000Z',
      externalEventId: `commercial-make-${Date.now()}`,
    });

    const snapshot = await getOpsSnapshot();
    const commercial = snapshot.automations.find((a) => a.id === 'commercial_lifecycle')!;
    expect(commercial.status).toBe('activity_observed');
    expect(commercial.clients.some((c) => c.clientId === client.id)).toBe(true);
  });

  it('a manual-only commercial event never counts as commercial-lifecycle AUTOMATION evidence', async () => {
    const client = await makeClient();
    const { lead } = await createLead({ scope: 'client', clientId: client.id, name: 'Manual-Only Commercial Lead' });
    createdLeadIds.push(lead.id);

    await appendCommercialEvent({
      leadId: lead.id,
      type: 'converted',
      source: 'manual',
      summary: 'Converted manually by an operator',
    });

    const snapshot = await getOpsSnapshot();
    const commercial = snapshot.automations.find((a) => a.id === 'commercial_lifecycle')!;
    expect(commercial.clients.find((c) => c.clientId === client.id)).toBeUndefined();
  });

  it('a quiet Make-mediated workflow/connection is configured or not_configured, never needs_attention', async () => {
    const snapshot = await getOpsSnapshot();
    for (const automation of snapshot.automations) {
      expect(automation.status).not.toBe('needs_attention');
    }
    expect(snapshot.connections.find((c) => c.id === 'make')?.status).not.toBe('needs_attention');
  });

  it('Google Sheets always reports unknown — never a fabricated operational/configured state', async () => {
    const snapshot = await getOpsSnapshot();
    expect(snapshot.connections.find((c) => c.id === 'google_sheets')?.status).toBe('unknown');
  });

  it('regression: global getOpsSnapshot automations/agent keep their per-client "clients" evidence list (unchanged shape)', async () => {
    const snapshot = await getOpsSnapshot();
    for (const automation of snapshot.automations) {
      expect(Array.isArray(automation.clients)).toBe(true);
    }
    expect(Array.isArray(snapshot.agent.clients)).toBe(true);
  });
});

describe.runIf(Boolean(TEST_DATABASE_URL))('lib/server/ops-status — getClientOpsSnapshot (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const createdLeadIds: string[] = [];

  async function makeClient(overrides: Partial<Parameters<typeof createClient>[0]> = {}) {
    const client = await createClient({
      name: 'Client Ops Snapshot Test Client',
      sector: 'Testing',
      status: 'prospect',
      service: 'Client ops snapshot fixture',
      metaBudgetMonthly: 0,
      startDate: '2026-01-01',
      owner: 'test-suite',
      ...overrides,
    });
    createdClientIds.push(client.id);
    return client;
  }

  afterEach(async () => {
    const leadIds = createdLeadIds.splice(0);
    if (leadIds.length > 0) {
      await query('DELETE FROM lead_events WHERE lead_id = ANY($1)', [leadIds]);
      await query('DELETE FROM leads WHERE id = ANY($1)', [leadIds]);
    }
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE client_id = $1)', [id]);
      await query('DELETE FROM leads WHERE client_id = $1', [id]);
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    await closePool();
  });

  it('returns the 5 canonical workflows and the agent, scoped to this client only, without a "clients" evidence list', async () => {
    const client = await makeClient();
    const snapshot = await getClientOpsSnapshot(client.id);

    expect(snapshot.automations.map((a) => a.id).sort()).toEqual(
      ['commercial_lifecycle', 'lead_intake', 'lead_qualification', 'whatsapp_inbound', 'whatsapp_outbound'].sort(),
    );
    expect(snapshot.agent.id).toBe('lead_qualification_agent');
    for (const automation of snapshot.automations) {
      expect('clients' in automation).toBe(false);
    }
    expect('clients' in snapshot.agent).toBe(false);
  });

  it('[A] per-client isolation: evidence for client A never leaks into client B\'s snapshot', async () => {
    const clientA = await makeClient();
    const clientB = await makeClient();

    const resultA = await ingestLeadTransactional({
      scope: 'client',
      clientId: clientA.id,
      name: 'Client A Lead',
      deliveryId: `delivery-${Date.now()}-a`,
      ingestionSource: 'meta',
      externalLeadId: `meta-a-${Date.now()}`,
      aiAnalysis: { summary: 'Qualified', intent: 'hot', priority: 'high', qualification: null, analyzedAt: null },
    });
    createdLeadIds.push(resultA.lead.id);

    const { lead: leadB } = await createLead({ scope: 'client', clientId: clientB.id, name: 'Client B Lead, no evidence' });
    createdLeadIds.push(leadB.id);

    const snapshotA = await getClientOpsSnapshot(clientA.id);
    const snapshotB = await getClientOpsSnapshot(clientB.id);

    const leadIntakeA = snapshotA.automations.find((a) => a.id === 'lead_intake')!;
    const leadIntakeB = snapshotB.automations.find((a) => a.id === 'lead_intake')!;
    expect(leadIntakeA.status).toBe('activity_observed');
    expect(leadIntakeB.status).not.toBe('activity_observed');

    const qualA = snapshotA.automations.find((a) => a.id === 'lead_qualification')!;
    const qualB = snapshotB.automations.find((a) => a.id === 'lead_qualification')!;
    expect(qualA.status).toBe('activity_observed');
    expect(qualB.status).not.toBe('activity_observed');

    expect(snapshotA.agent.status).toBe('activity_observed');
    expect(snapshotB.agent.status).not.toBe('activity_observed');
  });

  it('[B] finds a client\'s own evidence even when 6+ other clients have more recent activity (defeats the global top-6 limit)', async () => {
    const quietClient = await makeClient();
    const quietResult = await ingestLeadTransactional({
      scope: 'client',
      clientId: quietClient.id,
      name: 'Quiet Client Lead',
      deliveryId: `delivery-${Date.now()}-quiet`,
      ingestionSource: 'meta',
      externalLeadId: `meta-quiet-${Date.now()}`,
    });
    createdLeadIds.push(quietResult.lead.id);

    // 6 other clients with strictly newer Meta lead-intake evidence — enough
    // to push the quiet client out of getOpsSnapshot's global top-6 for this
    // signal, which is exactly the bug per-client filtering must not repeat.
    for (let i = 0; i < 6; i++) {
      const noisyClient = await makeClient();
      const noisyResult = await ingestLeadTransactional({
        scope: 'client',
        clientId: noisyClient.id,
        name: `Noisy Client Lead ${i}`,
        deliveryId: `delivery-${Date.now()}-noisy-${i}`,
        ingestionSource: 'meta',
        externalLeadId: `meta-noisy-${i}-${Date.now()}`,
      });
      createdLeadIds.push(noisyResult.lead.id);
    }

    const snapshot = await getClientOpsSnapshot(quietClient.id);
    const leadIntake = snapshot.automations.find((a) => a.id === 'lead_intake')!;
    expect(leadIntake.status).toBe('activity_observed');
    expect(leadIntake.lastActivityAt).not.toBeNull();
  });

  it('[C] a client with zero evidence is configured/not_configured, never needs_attention', async () => {
    const client = await makeClient();
    const snapshot = await getClientOpsSnapshot(client.id);
    for (const automation of snapshot.automations) {
      expect(automation.status).not.toBe('needs_attention');
      expect(['configured', 'not_configured']).toContain(automation.status);
    }
    expect(snapshot.agent.status).not.toBe('needs_attention');
    expect(['configured', 'not_configured']).toContain(snapshot.agent.status);
  });

  it('[D] commercial lifecycle: source=manual never produces activity_observed for this client, source=make does', async () => {
    const client = await makeClient();
    const { lead } = await createLead({ scope: 'client', clientId: client.id, name: 'Commercial Lifecycle Client Lead' });
    createdLeadIds.push(lead.id);

    await appendCommercialEvent({
      leadId: lead.id,
      type: 'converted',
      source: 'manual',
      summary: 'Converted manually by an operator',
    });

    let snapshot = await getClientOpsSnapshot(client.id);
    let commercial = snapshot.automations.find((a) => a.id === 'commercial_lifecycle')!;
    expect(commercial.status).not.toBe('activity_observed');

    await appendCommercialEvent({
      leadId: lead.id,
      type: 'appointment_booked',
      source: 'make',
      summary: 'Booked by Make',
      appointmentDate: '2026-09-01T10:00:00.000Z',
      externalEventId: `commercial-client-make-${Date.now()}`,
    });

    snapshot = await getClientOpsSnapshot(client.id);
    commercial = snapshot.automations.find((a) => a.id === 'commercial_lifecycle')!;
    expect(commercial.status).toBe('activity_observed');
  });

  it('[E] the client agent snapshot never includes a model field or a model name', async () => {
    const client = await makeClient();
    const result = await ingestLeadTransactional({
      scope: 'client',
      clientId: client.id,
      name: 'Agent Evidence Lead',
      deliveryId: `delivery-${Date.now()}-agent`,
      ingestionSource: 'meta',
      externalLeadId: `meta-agent-${Date.now()}`,
      aiAnalysis: { summary: 'Qualified lead', intent: 'hot', priority: 'high', qualification: null, analyzedAt: null },
    });
    createdLeadIds.push(result.lead.id);

    const snapshot = await getClientOpsSnapshot(client.id);
    expect(snapshot.agent.status).toBe('activity_observed');
    expect('model' in snapshot.agent).toBe(false);
    expect(JSON.stringify(snapshot.agent)).not.toMatch(/gpt-4o|claude-sonnet/i);
  });

  it('[F] never returns DATABASE_URL, API keys, or any other secret value', async () => {
    const client = await makeClient();
    const snapshot = await getClientOpsSnapshot(client.id);
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toContain(TEST_DATABASE_URL);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//i);
    if (process.env.INGEST_API_KEY) expect(serialized).not.toContain(process.env.INGEST_API_KEY);
    if (process.env.MAKE_EVENTS_API_KEY) expect(serialized).not.toContain(process.env.MAKE_EVENTS_API_KEY);

    const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential)$/i;
    const assertNoSecretKeys = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(assertNoSecretKeys);
      } else if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
          expect(SECRET_KEY_PATTERN.test(key)).toBe(false);
          assertNoSecretKeys(nested);
        }
      }
    };
    assertNoSecretKeys(snapshot);
  });
});

describe('getOpsSnapshot — env-only (no DB required, always runs)', () => {
  const originalDb = process.env.DATABASE_URL;
  const originalIngest = process.env.INGEST_API_KEY;
  const originalMakeEvents = process.env.MAKE_EVENTS_API_KEY;

  afterEach(() => {
    if (originalDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDb;
    if (originalIngest === undefined) delete process.env.INGEST_API_KEY;
    else process.env.INGEST_API_KEY = originalIngest;
    if (originalMakeEvents === undefined) delete process.env.MAKE_EVENTS_API_KEY;
    else process.env.MAKE_EVENTS_API_KEY = originalMakeEvents;
  });

  it('degrades safely to not_configured/unknown everywhere, and never throws, when DATABASE_URL is absent', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.INGEST_API_KEY;
    delete process.env.MAKE_EVENTS_API_KEY;

    const snapshot = await getOpsSnapshot();

    expect(snapshot.postgres.status).toBe('not_configured');
    expect(snapshot.connections.find((c) => c.id === 'postgresql')?.status).toBe('not_configured');
    expect(snapshot.connections.find((c) => c.id === 'make')?.status).toBe('not_configured');
    expect(snapshot.connections.find((c) => c.id === 'meta_ads')?.status).toBe('unknown');
    expect(snapshot.connections.find((c) => c.id === 'google_sheets')?.status).toBe('unknown');
    for (const automation of snapshot.automations) {
      expect(automation.status).toBe('not_configured');
    }
    expect(snapshot.attention.some((a) => a.id === 'db-not-configured')).toBe(true);
    expect(snapshot.attention.some((a) => a.id === 'ingest-key-missing')).toBe(true);
    expect(snapshot.attention.some((a) => a.id === 'make-events-key-missing')).toBe(true);
  });

  it('reports configured (not not_configured) once the Make receiver keys are set, even without DATABASE_URL', async () => {
    delete process.env.DATABASE_URL;
    process.env.INGEST_API_KEY = 'test-key';
    process.env.MAKE_EVENTS_API_KEY = 'test-key';

    const snapshot = await getOpsSnapshot();
    expect(snapshot.connections.find((c) => c.id === 'make')?.status).toBe('configured');
    expect(snapshot.attention.some((a) => a.id === 'ingest-key-missing')).toBe(false);
    expect(snapshot.attention.some((a) => a.id === 'make-events-key-missing')).toBe(false);
  });
});

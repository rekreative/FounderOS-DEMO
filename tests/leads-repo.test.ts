import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import * as leadsRepo from '@/lib/server/leads-repo';
import {
  LeadNotFoundError,
  LeadValidationError,
  appendLeadEvent,
  createLead,
  findByDeliveryId,
  findByExternalIdentity,
  getLeadById,
  ingestLeadTransactional,
  listLeadEvents,
  listLeads,
  setLeadStage,
} from '@/lib/server/leads-repo';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

// Integration tests against a real Postgres test database (see
// tests/helpers/pg-test-env.ts - requires an explicit TEST_DATABASE_URL,
// never DATABASE_URL/.env.local, which may be production). Every
// client/lead this file creates is tracked by id and deleted in afterEach,
// in FK-safe order (lead_events → leads → clients) — never a blanket
// DELETE. Skips cleanly when no TEST_DATABASE_URL is configured.
const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('lib/server/leads-repo (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const createdLeadIds: string[] = [];

  async function makeClient(overrides: Partial<Parameters<typeof createClient>[0]> = {}) {
    const client = await createClient({
      name: 'Leads Repo Test Client',
      sector: 'Testing',
      status: 'prospect',
      service: 'Repo test fixture',
      metaBudgetMonthly: 0,
      startDate: '2026-01-01',
      owner: 'test-suite',
      ...overrides,
    });
    createdClientIds.push(client.id);
    return client;
  }

  async function makeLead(input: Parameters<typeof createLead>[0]) {
    const { lead, event } = await createLead(input);
    createdLeadIds.push(lead.id);
    return { lead, event };
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

  describe('scope/client invariant', () => {
    it('creates an internal lead with clientId null', async () => {
      const { lead } = await makeLead({ scope: 'internal', name: 'Internal Prospect' });
      expect(lead.scope).toBe('internal');
      expect(lead.clientId).toBeNull();
    });

    it('creates a client lead with a valid clientId', async () => {
      const client = await makeClient();
      const { lead } = await makeLead({ scope: 'client', clientId: client.id, name: 'Client Lead' });
      expect(lead.scope).toBe('client');
      expect(lead.clientId).toBe(client.id);
    });

    it('rejects a client-scoped lead whose clientId does not exist', async () => {
      await expect(
        createLead({ scope: 'client', clientId: 'client-does-not-exist', name: 'Ghost' }),
      ).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' } satisfies Partial<LeadValidationError>);
    });

    it('rejects a client-scoped lead with no clientId at all', async () => {
      await expect(createLead({ scope: 'client', name: 'No Client' })).rejects.toMatchObject({
        code: 'CLIENT_ID_REQUIRED',
      } satisfies Partial<LeadValidationError>);
    });

    it('rejects an internal-scoped lead that also carries a clientId', async () => {
      const client = await makeClient();
      await expect(
        createLead({ scope: 'internal', clientId: client.id, name: 'Should Not Exist' }),
      ).rejects.toMatchObject({ code: 'CLIENT_ID_NOT_ALLOWED' } satisfies Partial<LeadValidationError>);
    });

    it('rolls back the whole createLead transaction on a rejected DB invariant — no orphaned event', async () => {
      // Bypasses TypeScript's LeadStage union to exercise the DB CHECK
      // constraint directly (defense in depth) — this must never partially
      // persist a lead with no matching lead_received event, or vice versa.
      await expect(
        createLead({ scope: 'internal', name: 'Bad Stage', stage: 'not_a_real_stage' as never }),
      ).rejects.toThrow();
      const orphans = await query('SELECT le.id FROM lead_events le LEFT JOIN leads l ON l.id = le.lead_id WHERE l.id IS NULL');
      expect(orphans.rowCount).toBe(0);
    });
  });

  describe('createLead — atomic initial timeline', () => {
    it('inserts exactly one lead_received event, sourced "manual"', async () => {
      const { lead } = await makeLead({ scope: 'internal', name: 'Timeline Check' });
      const events = await listLeadEvents(lead.id);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('lead_received');
      expect(events[0].source).toBe('manual');
      expect(events[0].summary).toBe('Timeline Check was added to the REKREATIVE CRM');
    });
  });

  describe('setLeadStage — atomic stage change', () => {
    it('appends a stage_changed event when the stage actually changes', async () => {
      const { lead } = await makeLead({ scope: 'internal', name: 'Stage Mover' });
      const result = await setLeadStage(lead.id, 'qualified');
      expect(result?.lead.stage).toBe('qualified');
      expect(result?.event?.type).toBe('stage_changed');
      expect(result?.event?.details).toEqual({ from: 'new', to: 'qualified' });

      const events = await listLeadEvents(lead.id);
      expect(events).toHaveLength(2);
    });

    it('does not append a misleading duplicate event when the stage is unchanged', async () => {
      const { lead } = await makeLead({ scope: 'internal', name: 'Stage Stayer' });
      const result = await setLeadStage(lead.id, lead.stage);
      expect(result?.event).toBeNull();

      const events = await listLeadEvents(lead.id);
      expect(events).toHaveLength(1); // only the original lead_received
    });

    it('returns null for an unknown lead id', async () => {
      expect(await setLeadStage('lead-does-not-exist', 'qualified')).toBeNull();
    });

    it('rolls back entirely if the new stage violates the DB CHECK (defense in depth)', async () => {
      const { lead } = await makeLead({ scope: 'internal', name: 'Stage Guard' });
      await expect(setLeadStage(lead.id, 'not_a_real_stage' as never)).rejects.toThrow();

      const reloaded = await getLeadById(lead.id);
      expect(reloaded?.stage).toBe('new'); // unchanged
      const events = await listLeadEvents(lead.id);
      expect(events).toHaveLength(1); // no stray stage_changed
    });
  });

  describe('listLeads — SQL-level filtering', () => {
    it('filters by clientId, excluding other clients', async () => {
      const clientA = await makeClient({ name: 'Client A' });
      const clientB = await makeClient({ name: 'Client B' });
      const { lead: leadA } = await makeLead({ scope: 'client', clientId: clientA.id, name: 'Lead A' });
      await makeLead({ scope: 'client', clientId: clientB.id, name: 'Lead B' });

      const results = await listLeads({ clientId: clientA.id });
      expect(results.map((l) => l.id)).toEqual([leadA.id]);
    });

    it('filters by scope', async () => {
      const client = await makeClient();
      const { lead: internalLead } = await makeLead({ scope: 'internal', name: 'Scope Internal' });
      await makeLead({ scope: 'client', clientId: client.id, name: 'Scope Client' });

      const results = await listLeads({ scope: 'internal' });
      expect(results.map((l) => l.id)).toContain(internalLead.id);
      expect(results.every((l) => l.scope === 'internal')).toBe(true);
    });
  });

  describe('lead_events — append-only', () => {
    it('lists the timeline in occurred_at order regardless of insertion order', async () => {
      const { lead } = await makeLead({ scope: 'internal', name: 'Timeline Order' });
      const earlier = new Date(Date.now() - 60_000).toISOString();
      await appendLeadEvent({ leadId: lead.id, type: 'manual_note', source: 'manual', summary: 'later note' });
      await appendLeadEvent({ leadId: lead.id, type: 'manual_note', source: 'manual', summary: 'earlier note', occurredAt: earlier });

      const events = await listLeadEvents(lead.id);
      const occurredTimes = events.map((e) => new Date(e.occurredAt).getTime());
      expect(occurredTimes).toEqual([...occurredTimes].sort((a, b) => a - b));
      expect(events[0].summary).toBe('earlier note');
    });

    it('exposes no update/delete surface for events — append-only by omission', () => {
      expect('updateLeadEvent' in leadsRepo).toBe(false);
      expect('deleteLeadEvent' in leadsRepo).toBe(false);
    });

    it('throws LeadNotFoundError appending to a lead that does not exist', async () => {
      await expect(
        appendLeadEvent({ leadId: 'lead-does-not-exist', type: 'manual_note', source: 'manual', summary: 'x' }),
      ).rejects.toBeInstanceOf(LeadNotFoundError);
    });

    it('rejects an invalid event type/source via the DB CHECK constraint (defense in depth)', async () => {
      const { lead } = await makeLead({ scope: 'internal', name: 'Bad Event' });
      await expect(
        appendLeadEvent({ leadId: lead.id, type: 'not_a_type' as never, source: 'manual', summary: 'x' }),
      ).rejects.toThrow();
      await expect(
        appendLeadEvent({ leadId: lead.id, type: 'manual_note', source: 'not_a_source' as never, summary: 'x' }),
      ).rejects.toThrow();
    });
  });

  describe('ingestion primitives (not yet exposed via HTTP)', () => {
    it('a retried delivery of the same execution dedupes with no new event', async () => {
      const first = await ingestLeadTransactional({
        scope: 'internal',
        name: 'Ingested Once',
        deliveryId: 'delivery-1',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-1',
      });
      createdLeadIds.push(first.lead.id);
      expect(first.deduped).toBe(false);
      expect(first.event?.source).toBe('make');

      const retried = await ingestLeadTransactional({
        scope: 'internal',
        name: 'Ingested Once',
        deliveryId: 'delivery-1',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-1',
      });
      expect(retried.deduped).toBe(true);
      expect(retried.event).toBeNull();
      expect(retried.lead.id).toBe(first.lead.id);

      const events = await listLeadEvents(first.lead.id);
      expect(events).toHaveLength(1);
    });

    it('the same upstream lead via a different delivery also dedupes with no new event', async () => {
      const first = await ingestLeadTransactional({
        scope: 'internal',
        name: 'Same Meta Lead',
        deliveryId: 'delivery-A',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-2',
      });
      createdLeadIds.push(first.lead.id);

      const second = await ingestLeadTransactional({
        scope: 'internal',
        name: 'Same Meta Lead',
        deliveryId: 'delivery-B',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-2',
      });
      expect(second.deduped).toBe(true);
      expect(second.lead.id).toBe(first.lead.id);

      const events = await listLeadEvents(first.lead.id);
      expect(events).toHaveLength(1);
    });

    it('a different delivery and a different upstream lead is genuinely new', async () => {
      const first = await ingestLeadTransactional({
        scope: 'internal',
        name: 'Lead One',
        deliveryId: 'delivery-C',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-3',
      });
      const second = await ingestLeadTransactional({
        scope: 'internal',
        name: 'Lead Two',
        deliveryId: 'delivery-D',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-4',
      });
      createdLeadIds.push(first.lead.id, second.lead.id);

      expect(second.deduped).toBe(false);
      expect(first.lead.id).not.toBe(second.lead.id);
    });

    it('a fresh insert with aiAnalysis stamps ai_analyzed_at and appends lead_received then ai_analyzed', async () => {
      const { lead } = await ingestLeadTransactional({
        scope: 'internal',
        name: 'AI Qualified Lead',
        deliveryId: 'delivery-ai-1',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-ai-1',
        aiAnalysis: { summary: 'Great fit', intent: 'hot', priority: 'high', qualification: { pain: 'x' }, analyzedAt: null },
      });
      createdLeadIds.push(lead.id);

      expect(lead.aiAnalysis?.analyzedAt).not.toBeNull();

      const events = await listLeadEvents(lead.id);
      expect(events.map((e) => e.type)).toEqual(['lead_received', 'ai_analyzed']);
      expect(events[0].source).toBe('make');
      expect(events[1].source).toBe('openai');
    });

    it('a fresh insert without aiAnalysis leaves ai_analyzed_at null and appends only lead_received', async () => {
      const { lead } = await ingestLeadTransactional({
        scope: 'internal',
        name: 'No AI Lead',
        deliveryId: 'delivery-no-ai-1',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-no-ai-1',
      });
      createdLeadIds.push(lead.id);

      expect(lead.aiAnalysis).toBeNull();

      const events = await listLeadEvents(lead.id);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('lead_received');
    });

    it('a deliveryId replay with aiAnalysis dedupes with no additional lead_received or ai_analyzed event', async () => {
      const input = {
        scope: 'internal' as const,
        name: 'AI Replay Lead',
        deliveryId: 'delivery-ai-replay',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-ai-replay',
        aiAnalysis: { summary: 'Great fit', intent: 'hot', priority: 'high', qualification: null, analyzedAt: null } as const,
      };
      const first = await ingestLeadTransactional(input);
      createdLeadIds.push(first.lead.id);
      expect(first.deduped).toBe(false);

      const second = await ingestLeadTransactional(input);
      expect(second.deduped).toBe(true);
      expect(second.lead.id).toBe(first.lead.id);
      expect(second.lead.aiAnalysis?.analyzedAt).toBe(first.lead.aiAnalysis?.analyzedAt);

      const events = await listLeadEvents(first.lead.id);
      expect(events.map((e) => e.type)).toEqual(['lead_received', 'ai_analyzed']);
    });

    it('the same upstream lead via a different delivery, with aiAnalysis, dedupes with no additional events', async () => {
      const aiAnalysis = { summary: 'Great fit', intent: 'hot', priority: 'high', qualification: null, analyzedAt: null } as const;
      const first = await ingestLeadTransactional({
        scope: 'internal',
        name: 'AI External Dedupe A',
        deliveryId: 'delivery-ai-ext-A',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-ai-ext',
        aiAnalysis,
      });
      createdLeadIds.push(first.lead.id);

      const second = await ingestLeadTransactional({
        scope: 'internal',
        name: 'AI External Dedupe B',
        deliveryId: 'delivery-ai-ext-B',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-ai-ext',
        aiAnalysis,
      });
      expect(second.deduped).toBe(true);
      expect(second.lead.id).toBe(first.lead.id);

      const events = await listLeadEvents(first.lead.id);
      expect(events.map((e) => e.type)).toEqual(['lead_received', 'ai_analyzed']);
    });

    it('findByDeliveryId / findByExternalIdentity resolve what ingestLeadTransactional created', async () => {
      const { lead } = await ingestLeadTransactional({
        scope: 'internal',
        name: 'Findable Lead',
        deliveryId: 'delivery-E',
        ingestionSource: 'meta',
        externalLeadId: 'meta-lead-5',
      });
      createdLeadIds.push(lead.id);

      expect((await findByDeliveryId('delivery-E'))?.id).toBe(lead.id);
      expect((await findByExternalIdentity('meta', 'meta-lead-5'))?.id).toBe(lead.id);
      expect(await findByDeliveryId('delivery-does-not-exist')).toBeNull();
    });
  });
});

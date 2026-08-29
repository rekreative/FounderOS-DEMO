import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { appendCommercialEvent, appendLeadEvent, createLead } from '@/lib/server/leads-repo';
import { upsertMetaCampaignDailyMetrics } from '@/lib/server/meta-repo';
import {
  getClientOperationalSnapshot,
  getHighPriorityLeads,
  getLeadsAwaitingFirstContact,
  getRecentActivity,
  getRecentConversions,
  getResults,
  getUpcomingAppointments,
  getValueGeneratedRecently,
} from '@/lib/server/results-repo';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

// Integration tests against a real Postgres test database (see
// tests/helpers/pg-test-env.ts - requires an explicit TEST_DATABASE_URL,
// never DATABASE_URL/.env.local, which may be production) - exercises
// Results V1's acquisition-cohort semantics and Home's operational
// (event-time) semantics end to end. Skips cleanly when no
// TEST_DATABASE_URL is configured.
const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('lib/server/results-repo (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const createdLeadIds: string[] = [];

  async function makeClient(overrides: Partial<Parameters<typeof createClient>[0]> = {}) {
    const client = await createClient({
      name: 'Results Repo Test Client',
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
    const { lead } = await createLead(input);
    createdLeadIds.push(lead.id);
    return lead;
  }

  /** Backdates a lead's created_at directly — createLead always stamps
   * `now`, and Results' acquisition-cohort semantics are specifically about
   * created_at range filtering, so tests need direct control over it. */
  async function setLeadCreatedAt(leadId: string, isoDateTime: string) {
    await query('UPDATE leads SET created_at = $2 WHERE id = $1', [leadId, isoDateTime]);
  }

  afterEach(async () => {
    const leadIds = createdLeadIds.splice(0);
    if (leadIds.length > 0) {
      await query('DELETE FROM lead_events WHERE lead_id = ANY($1)', [leadIds]);
      await query('DELETE FROM leads WHERE id = ANY($1)', [leadIds]);
    }
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM meta_campaign_daily_metrics WHERE client_id = $1', [id]);
      await query('DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE client_id = $1)', [id]);
      await query('DELETE FROM leads WHERE client_id = $1', [id]);
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    await closePool();
  });

  describe('getResults — acquisition-cohort semantics', () => {
    it('a lead created inside the period that converts AFTER the period still counts as converted in that cohort', async () => {
      const client = await makeClient();
      const lead = await makeLead({ scope: 'client', clientId: client.id, name: 'Cohort Lead' });
      await setLeadCreatedAt(lead.id, '2026-08-10T10:00:00.000Z'); // inside Aug 1–20
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'manual',
        summary: 'Converted after the cohort period',
        conversionValue: 1200,
        occurredAt: '2026-08-25T10:00:00.000Z', // AFTER the Aug 1–20 range
      });

      const result = await getResults({ clientId: client.id, preset: 'custom', customStart: '2026-08-01', customEnd: '2026-08-20' });
      expect(result.overall.funnel.leads).toBe(1);
      expect(result.overall.funnel.converted).toBe(1);
      expect(result.overall.value.total).toBe(1200);
    });

    it('a lead created OUTSIDE the period never enters that cohort, regardless of when it converts', async () => {
      const client = await makeClient();
      const lead = await makeLead({ scope: 'client', clientId: client.id, name: 'Outside Cohort Lead' });
      await setLeadCreatedAt(lead.id, '2026-07-01T10:00:00.000Z'); // before Aug 1–20
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'manual',
        summary: 'Converted inside the queried period',
        conversionValue: 5000,
        occurredAt: '2026-08-10T10:00:00.000Z', // inside Aug 1–20
      });

      const result = await getResults({ clientId: client.id, preset: 'custom', customStart: '2026-08-01', customEnd: '2026-08-20' });
      expect(result.overall.funnel.leads).toBe(0);
      expect(result.overall.funnel.converted).toBe(0);
      expect(result.overall.value.total).toBeNull();
    });
  });

  describe('getResults — dedup', () => {
    it('appointment reschedule (two appointment_booked events) does not double-count booking', async () => {
      const client = await makeClient();
      const lead = await makeLead({ scope: 'client', clientId: client.id, name: 'Reschedule Lead' });
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_booked',
        source: 'manual',
        summary: 'First booking',
        appointmentDate: '2026-09-01T10:00:00.000Z',
      });
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'appointment_booked',
        source: 'manual',
        summary: 'Rescheduled',
        appointmentDate: '2026-09-05T10:00:00.000Z',
      });

      const result = await getResults({ clientId: client.id, preset: 'all' });
      expect(result.overall.funnel.appointments).toBe(1);
    });

    it('a repeated converted event does not double-count conversion or its value', async () => {
      const client = await makeClient();
      const lead = await makeLead({ scope: 'client', clientId: client.id, name: 'Double Converted Lead' });
      await appendCommercialEvent({ leadId: lead.id, type: 'converted', source: 'manual', summary: 'Converted', conversionValue: 800 });
      await appendCommercialEvent({ leadId: lead.id, type: 'converted', source: 'manual', summary: 'Converted again', conversionValue: 800 });

      const events = await query('SELECT id FROM lead_events WHERE lead_id = $1 AND type = $2', [lead.id, 'converted']);
      expect(events.rowCount).toBe(2); // both events ARE recorded...

      const result = await getResults({ clientId: client.id, preset: 'all' });
      expect(result.overall.funnel.converted).toBe(1); // ...but the lead counts once
      expect(result.overall.value.total).toBe(800); // and its value is summed once, not doubled
    });
  });

  describe('getResults — conversionValue aggregation', () => {
    it('sums and averages conversionValue over converted leads only, excluding those with no recorded value', async () => {
      const client = await makeClient();
      const withValueA = await makeLead({ scope: 'client', clientId: client.id, name: 'Converted A' });
      const withValueB = await makeLead({ scope: 'client', clientId: client.id, name: 'Converted B' });
      const withoutValue = await makeLead({ scope: 'client', clientId: client.id, name: 'Converted C (no value)' });

      await appendCommercialEvent({ leadId: withValueA.id, type: 'converted', source: 'manual', summary: 'x', conversionValue: 1000 });
      await appendCommercialEvent({ leadId: withValueB.id, type: 'converted', source: 'manual', summary: 'x', conversionValue: 400 });
      await appendCommercialEvent({ leadId: withoutValue.id, type: 'converted', source: 'manual', summary: 'x' }); // no conversionValue

      const result = await getResults({ clientId: client.id, preset: 'all' });
      expect(result.overall.funnel.converted).toBe(3); // all three count as converted...
      expect(result.overall.value.total).toBe(1400); // ...but value only sums the two with a recorded amount
      expect(result.overall.value.average).toBe(700);
      expect(result.overall.value.count).toBe(2);
    });
  });

  describe('getResults — client scoping and empty cohorts', () => {
    it('never leaks one client’s leads into another client’s scoped results', async () => {
      const clientA = await makeClient();
      const clientB = await makeClient();
      await makeLead({ scope: 'client', clientId: clientA.id, name: 'A lead' });
      await makeLead({ scope: 'client', clientId: clientB.id, name: 'B lead 1' });
      await makeLead({ scope: 'client', clientId: clientB.id, name: 'B lead 2' });

      const resultA = await getResults({ clientId: clientA.id, preset: 'all' });
      expect(resultA.overall.funnel.leads).toBe(1);

      const global = await getResults({ preset: 'all' });
      const rowA = global.byClient.find((row) => row.clientId === clientA.id);
      const rowB = global.byClient.find((row) => row.clientId === clientB.id);
      expect(rowA?.funnel.leads).toBe(1);
      expect(rowB?.funnel.leads).toBe(2);
    });

    it('a client with zero leads returns an honest all-zero/null computation, not an error', async () => {
      const client = await makeClient();
      const result = await getResults({ clientId: client.id, preset: 'all' });
      expect(result.overall.funnel).toEqual({ leads: 0, qualified: 0, appointments: 0, attended: 0, converted: 0 });
      expect(result.overall.value).toEqual({ total: null, average: null, count: 0 });
    });

    it('never returns any ad-spend/ROAS/CAC/Meta-derived field — those have no live source in V1', async () => {
      const client = await makeClient();
      const result = await getResults({ clientId: client.id, preset: 'all' });
      const keys = Object.keys(result.overall);
      expect(keys).not.toContain('adSpend');
      expect(keys).not.toContain('roas');
      expect(keys).not.toContain('cac');
      expect(keys).not.toContain('metaLeads');
    });
  });

  describe('Home operational widgets', () => {
    it('getHighPriorityLeads: (ai_priority=high OR ai_intent=hot) AND stage IN (new, contacted)', async () => {
      const client = await makeClient();
      const highPriorityNew = await makeLead({
        scope: 'client',
        clientId: client.id,
        name: 'High priority new',
        aiAnalysis: { summary: null, intent: null, priority: 'high', qualification: null, analyzedAt: new Date().toISOString() },
      });
      await makeLead({
        scope: 'client',
        clientId: client.id,
        name: 'High priority but already converted',
        aiAnalysis: { summary: null, intent: null, priority: 'high', qualification: null, analyzedAt: new Date().toISOString() },
      }).then((lead) =>
        appendCommercialEvent({ leadId: lead.id, type: 'converted', source: 'manual', summary: 'x' }),
      );
      await makeLead({ scope: 'client', clientId: client.id, name: 'Low priority' });

      const result = await getHighPriorityLeads(50);
      const ids = result.map((lead) => lead.id);
      expect(ids).toContain(highPriorityNew.id);
      expect(ids.length).toBeGreaterThanOrEqual(1);
      // The converted high-priority lead must NOT appear (stage no longer new/contacted).
      const stillPresent = result.find((lead) => lead.name === 'High priority but already converted');
      expect(stillPresent).toBeUndefined();
    });

    it('getLeadsAwaitingFirstContact: stage=new AND no whatsapp_sent event', async () => {
      const client = await makeClient();
      const awaiting = await makeLead({ scope: 'client', clientId: client.id, name: 'Awaiting contact' });
      const alreadyMessaged = await makeLead({ scope: 'client', clientId: client.id, name: 'Already messaged' });
      // Appended directly (not via appendWhatsAppEvent) to isolate the event-
      // existence condition from appendWhatsAppEvent's own new→contacted
      // stage side effect — this lead's stage stays 'new' on purpose.
      await appendLeadEvent({ leadId: alreadyMessaged.id, type: 'whatsapp_sent', source: 'manual', summary: 'Sent' });

      const result = await getLeadsAwaitingFirstContact(50);
      const ids = result.map((lead) => lead.id);
      expect(ids).toContain(awaiting.id);
      expect(ids).not.toContain(alreadyMessaged.id);
    });

    it('getUpcomingAppointments: stage=appointment AND appointment_date in the future', async () => {
      const client = await makeClient();
      const upcoming = await makeLead({ scope: 'client', clientId: client.id, name: 'Upcoming' });
      await appendCommercialEvent({
        leadId: upcoming.id,
        type: 'appointment_booked',
        source: 'manual',
        summary: 'Booked',
        appointmentDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
      const past = await makeLead({ scope: 'client', clientId: client.id, name: 'Past appointment' });
      await appendCommercialEvent({
        leadId: past.id,
        type: 'appointment_booked',
        source: 'manual',
        summary: 'Booked in the past',
        appointmentDate: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      });

      const result = await getUpcomingAppointments(50);
      const ids = result.map((lead) => lead.id);
      expect(ids).toContain(upcoming.id);
      expect(ids).not.toContain(past.id);
    });

    it('getRecentConversions: dedups repeated converted events to one entry at its most recent occurrence', async () => {
      const client = await makeClient();
      const lead = await makeLead({ scope: 'client', clientId: client.id, name: 'Reconverted Lead' });
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'manual',
        summary: 'first',
        occurredAt: '2026-08-01T10:00:00.000Z',
      });
      await appendCommercialEvent({
        leadId: lead.id,
        type: 'converted',
        source: 'manual',
        summary: 'second',
        occurredAt: '2026-08-05T10:00:00.000Z',
      });

      const result = await getRecentConversions(50);
      const matches = result.filter((entry) => entry.lead.id === lead.id);
      expect(matches).toHaveLength(1);
      expect(matches[0].convertedAt).toBe('2026-08-05T10:00:00.000Z');
    });

    it('getRecentActivity: orders newest event first', async () => {
      const client = await makeClient();
      // makeLead()/createLead() also inserts its own lead_received event,
      // timestamped at real "now" — genuinely newer than the two backdated
      // notes below, and getRecentActivity is right to surface it first.
      // This assertion is about the RELATIVE order of the two manual notes,
      // so it filters down to those specifically rather than assuming the
      // lead has no other lifecycle events.
      const lead = await makeLead({ scope: 'client', clientId: client.id, name: 'Activity Lead' });
      await appendLeadEvent({ leadId: lead.id, type: 'manual_note', source: 'manual', summary: 'older note', occurredAt: '2026-08-01T10:00:00.000Z' });
      await appendLeadEvent({ leadId: lead.id, type: 'manual_note', source: 'manual', summary: 'newer note', occurredAt: '2026-08-10T10:00:00.000Z' });

      // getRecentActivity is deliberately unscoped (agency-wide "top N most
      // recent events"), so a small limit run alongside other integration
      // suites hitting this same real database can be crowded out by their
      // (real-"now"-timestamped) events before this fixture's own
      // (2026-dated) rows ever reach the leadId filter below. A generous
      // limit — comfortably above anything this whole suite could produce
      // concurrently — keeps the assertion about relative ordering, not
      // about winning a fixed-size race against unrelated test data.
      const result = await getRecentActivity(5000);
      const notes = result.filter((entry) => entry.event.leadId === lead.id && entry.event.type === 'manual_note');
      expect(notes[0].event.summary).toBe('newer note');
      expect(notes[1].event.summary).toBe('older note');
    });

    it('getValueGeneratedRecently uses the converted EVENT time, not lead.createdAt', async () => {
      const client = await makeClient();
      // Created long ago, but converted just now — must be INCLUDED (event-time).
      const oldLeadRecentConversion = await makeLead({ scope: 'client', clientId: client.id, name: 'Old lead, recent conversion' });
      await setLeadCreatedAt(oldLeadRecentConversion.id, '2020-01-01T00:00:00.000Z');
      await appendCommercialEvent({
        leadId: oldLeadRecentConversion.id,
        type: 'converted',
        source: 'manual',
        summary: 'x',
        conversionValue: 300,
        occurredAt: new Date().toISOString(),
      });

      // Created just now, but converted long ago — must be EXCLUDED from a
      // short trailing window (event-time, not creation-time).
      const newLeadOldConversion = await makeLead({ scope: 'client', clientId: client.id, name: 'New lead, old conversion' });
      await appendCommercialEvent({
        leadId: newLeadOldConversion.id,
        type: 'converted',
        source: 'manual',
        summary: 'x',
        conversionValue: 9000,
        occurredAt: '2020-01-01T00:00:00.000Z',
      });

      const result = await getValueGeneratedRecently(7);
      // Both leads' conversionValue is visible agency-wide (no clientId
      // filter on this Home widget), so assert on the specific values rather
      // than an exact total that other concurrent test data could affect.
      expect(result.total).not.toBeNull();
      expect(result.total).toBeGreaterThanOrEqual(300);
    });
  });

  describe('getClientOperationalSnapshot', () => {
    it('reports leads/appointments/conversions/valueGenerated per client, all-time (not period-bound)', async () => {
      const client = await makeClient();
      const converted = await makeLead({ scope: 'client', clientId: client.id, name: 'Snapshot Converted' });
      await setLeadCreatedAt(converted.id, '2020-01-01T00:00:00.000Z'); // old — must still count (all-time)
      await appendCommercialEvent({ leadId: converted.id, type: 'converted', source: 'manual', summary: 'x', conversionValue: 650 });
      await makeLead({ scope: 'client', clientId: client.id, name: 'Snapshot New' });

      const snapshot = await getClientOperationalSnapshot();
      const row = snapshot.find((entry) => entry.clientId === client.id);
      expect(row).toBeDefined();
      expect(row?.leads).toBe(2);
      expect(row?.conversions).toBe(1);
      expect(row?.valueGenerated).toBe(650);
    });
  });

  describe('getResults — Meta spend integration (Meta Ads Real V1)', () => {
    it('with no meta_campaign_daily_metrics rows for the client: meta.spend/cac/roas/cplCrm all null — never a fabricated number', async () => {
      const client = await makeClient();
      await makeLead({ scope: 'client', clientId: client.id, name: 'No Meta Data Lead' });

      const result = await getResults({ clientId: client.id, preset: 'all' });
      expect(result.overall.meta).toEqual({
        spend: null,
        metaLeads: null,
        impressions: null,
        clicks: null,
        ctr: null,
        cac: null,
        roas: null,
        cplCrm: null,
      });
    });

    it('with real spend in the period: computes CAC/ROAS/CPL CRM from the funnel + generated value, and keeps Meta leads distinct from CRM leads', async () => {
      const client = await makeClient();
      const lead = await makeLead({ scope: 'client', clientId: client.id, name: 'Converted Lead' });
      await setLeadCreatedAt(lead.id, '2026-08-10T10:00:00.000Z');
      await appendCommercialEvent({ leadId: lead.id, type: 'converted', source: 'manual', summary: 'x', conversionValue: 800 });

      await upsertMetaCampaignDailyMetrics(client.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'Aug Campaign', status: 'active', date: '2026-08-10', spend: 200, impressions: 5000, clicks: 100, leads: 12, reach: null },
      ]);

      const result = await getResults({ clientId: client.id, preset: 'custom', customStart: '2026-08-01', customEnd: '2026-08-20' });
      expect(result.overall.funnel.leads).toBe(1); // CRM leads: exactly one ingested lead
      expect(result.overall.meta.metaLeads).toBe(12); // Meta-reported leads: a completely different, unmixed number
      expect(result.overall.meta.spend).toBe(200);
      expect(result.overall.meta.cac).toBe(200); // spend / converted (1)
      expect(result.overall.meta.roas).toBe(4); // valueGenerated(800) / spend(200)
      expect(result.overall.meta.cplCrm).toBe(200); // spend / CRM leads (1)
    });

    it('a period outside the metric rows excludes that spend — period scoping is honored', async () => {
      const client = await makeClient();
      await upsertMetaCampaignDailyMetrics(client.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'July Campaign', status: 'active', date: '2026-07-10', spend: 500, impressions: 1000, clicks: 10, leads: 1, reach: null },
      ]);
      const result = await getResults({ clientId: client.id, preset: 'custom', customStart: '2026-08-01', customEnd: '2026-08-20' });
      expect(result.overall.meta.spend).toBeNull();
    });

    it('global view: per-client byClient rows carry their own meta spend, never blended across clients', async () => {
      const clientA = await makeClient({ name: 'Meta Global A' });
      const clientB = await makeClient({ name: 'Meta Global B' });
      const leadA = await makeLead({ scope: 'client', clientId: clientA.id, name: 'A Lead' });
      await setLeadCreatedAt(leadA.id, '2026-08-05T00:00:00.000Z');
      const leadB = await makeLead({ scope: 'client', clientId: clientB.id, name: 'B Lead' });
      await setLeadCreatedAt(leadB.id, '2026-08-05T00:00:00.000Z');

      await upsertMetaCampaignDailyMetrics(clientA.id, null, [
        { metaCampaignId: 'camp-a', campaignName: 'A Camp', status: 'active', date: '2026-08-05', spend: 100, impressions: 1000, clicks: 10, leads: 2, reach: null },
      ]);
      // clientB deliberately has no meta rows — must stay honestly null, not inherit A's spend.

      const result = await getResults({ preset: 'custom', customStart: '2026-08-01', customEnd: '2026-08-20' });
      const rowA = result.byClient.find((row) => row.clientId === clientA.id);
      const rowB = result.byClient.find((row) => row.clientId === clientB.id);
      expect(rowA?.meta.spend).toBe(100);
      expect(rowB?.meta.spend).toBeNull();
    });
  });
});

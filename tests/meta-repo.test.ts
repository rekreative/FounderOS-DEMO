import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import {
  createClientMetaAccount,
  getActiveClientMetaAccountByAdAccountId,
  getClientMetaAccountById,
  getLatestSyncRun,
  getMetaCampaignSummaries,
  getMetaSpendSummary,
  getMetaSpendSummaryByClient,
  listClientMetaAccounts,
  listRecentSyncRuns,
  recordSyncRun,
  updateClientMetaAccount,
  upsertMetaCampaignDailyMetrics,
} from '@/lib/server/meta-repo';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('lib/server/meta-repo (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const rand = () => Math.random().toString(36).slice(2);

  async function makeClient(overrides: Partial<Parameters<typeof createClient>[0]> = {}) {
    const client = await createClient({
      name: 'Meta Repo Test Client',
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

  afterEach(async () => {
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM meta_campaign_daily_metrics WHERE client_id = $1', [id]);
      await query('DELETE FROM meta_sync_runs WHERE client_id = $1', [id]);
      await query('DELETE FROM client_meta_accounts WHERE client_id = $1', [id]);
      await query('DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE client_id = $1)', [id]);
      await query('DELETE FROM leads WHERE client_id = $1', [id]);
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    await closePool();
  });

  describe('client_meta_accounts', () => {
    it('creates a mapping and maps every column back to camelCase', async () => {
      const client = await makeClient();
      const account = await createClientMetaAccount({
        clientId: client.id,
        metaAdAccountId: `act_${rand()}`,
        metaPageId: 'page_1',
        metaFormIds: ['form_1', 'form_2'],
        label: 'Cuenta principal',
      });
      expect(account.clientId).toBe(client.id);
      expect(account.metaPageId).toBe('page_1');
      expect(account.metaFormIds).toEqual(['form_1', 'form_2']);
      expect(account.active).toBe(true);
      expect(typeof account.createdAt).toBe('string');
    });

    it('defaults metaPageId/metaFormIds/label to null when omitted', async () => {
      const client = await makeClient();
      const account = await createClientMetaAccount({ clientId: client.id, metaAdAccountId: `act_${rand()}` });
      expect(account.metaPageId).toBeNull();
      expect(account.metaFormIds).toBeNull();
      expect(account.label).toBeNull();
    });

    it('rejects a mapping for an unknown client', async () => {
      await expect(createClientMetaAccount({ clientId: 'client-does-not-exist', metaAdAccountId: `act_${rand()}` })).rejects.toThrow();
    });

    it('rejects two ACTIVE mappings pointing at the same ad account id', async () => {
      const clientA = await makeClient({ name: 'Account Owner A' });
      const clientB = await makeClient({ name: 'Account Owner B' });
      const accountId = `act_${rand()}`;
      await createClientMetaAccount({ clientId: clientA.id, metaAdAccountId: accountId });
      await expect(createClientMetaAccount({ clientId: clientB.id, metaAdAccountId: accountId })).rejects.toThrow();
    });

    it('allows a deactivated mapping to be reassigned to a different client', async () => {
      const clientA = await makeClient({ name: 'Former Owner' });
      const clientB = await makeClient({ name: 'New Owner' });
      const accountId = `act_${rand()}`;
      const original = await createClientMetaAccount({ clientId: clientA.id, metaAdAccountId: accountId });
      await updateClientMetaAccount(original.id, { active: false });
      const reassigned = await createClientMetaAccount({ clientId: clientB.id, metaAdAccountId: accountId });
      expect(reassigned.clientId).toBe(clientB.id);
    });

    it('getActiveClientMetaAccountByAdAccountId resolves the mapped client, and null for unmapped/inactive', async () => {
      const client = await makeClient();
      const accountId = `act_${rand()}`;
      const created = await createClientMetaAccount({ clientId: client.id, metaAdAccountId: accountId });
      const resolved = await getActiveClientMetaAccountByAdAccountId(accountId);
      expect(resolved?.id).toBe(created.id);

      expect(await getActiveClientMetaAccountByAdAccountId(`act_unmapped_${rand()}`)).toBeNull();

      await updateClientMetaAccount(created.id, { active: false });
      expect(await getActiveClientMetaAccountByAdAccountId(accountId)).toBeNull();
    });

    it('listClientMetaAccounts scopes to one client and never leaks another client\'s mapping', async () => {
      const clientA = await makeClient({ name: 'List Scope A' });
      const clientB = await makeClient({ name: 'List Scope B' });
      await createClientMetaAccount({ clientId: clientA.id, metaAdAccountId: `act_${rand()}` });
      await createClientMetaAccount({ clientId: clientB.id, metaAdAccountId: `act_${rand()}` });

      const forA = await listClientMetaAccounts(clientA.id);
      expect(forA).toHaveLength(1);
      expect(forA[0].clientId).toBe(clientA.id);

      const all = await listClientMetaAccounts();
      const clientIds = all.map((a) => a.clientId);
      expect(clientIds).toContain(clientA.id);
      expect(clientIds).toContain(clientB.id);
    });

    it('updateClientMetaAccount patches only the given fields and bumps updatedAt', async () => {
      const client = await makeClient();
      const created = await createClientMetaAccount({ clientId: client.id, metaAdAccountId: `act_${rand()}`, label: 'Original' });
      const updated = await updateClientMetaAccount(created.id, { label: 'Renamed', metaPageId: 'page_9' });
      expect(updated?.label).toBe('Renamed');
      expect(updated?.metaPageId).toBe('page_9');
      expect(updated?.metaAdAccountId).toBe(created.metaAdAccountId);
    });

    it('getClientMetaAccountById returns null for an unknown id', async () => {
      expect(await getClientMetaAccountById('does-not-exist')).toBeNull();
    });
  });

  describe('meta_sync_runs', () => {
    it('records a run and getLatestSyncRun returns it', async () => {
      const client = await makeClient();
      const started = new Date('2026-06-01T10:00:00.000Z');
      const finished = new Date('2026-06-01T10:00:05.000Z');
      const run = await recordSyncRun({
        clientId: client.id,
        startedAt: started,
        finishedAt: finished,
        status: 'success',
        rowsUpserted: 3,
        errorMessage: null,
      });
      expect(run.status).toBe('success');
      expect(run.rowsUpserted).toBe(3);

      const latest = await getLatestSyncRun(client.id);
      expect(latest?.id).toBe(run.id);
    });

    it('getLatestSyncRun returns the most recently started run, not the most recently inserted', async () => {
      const client = await makeClient();
      const older = await recordSyncRun({
        clientId: client.id,
        startedAt: new Date('2026-06-01T08:00:00.000Z'),
        finishedAt: new Date('2026-06-01T08:00:01.000Z'),
        status: 'success',
        rowsUpserted: 1,
        errorMessage: null,
      });
      const newer = await recordSyncRun({
        clientId: client.id,
        startedAt: new Date('2026-06-02T08:00:00.000Z'),
        finishedAt: new Date('2026-06-02T08:00:01.000Z'),
        status: 'error',
        rowsUpserted: 0,
        errorMessage: 'Meta API timeout',
      });
      const latest = await getLatestSyncRun(client.id);
      expect(latest?.id).toBe(newer.id);
      expect(latest?.status).toBe('error');
      expect(latest?.errorMessage).toBe('Meta API timeout');
      void older;
    });

    it('getLatestSyncRun returns null when no runs exist for the client', async () => {
      const client = await makeClient();
      expect(await getLatestSyncRun(client.id)).toBeNull();
    });

    it('listRecentSyncRuns is scoped per client and ordered newest-first', async () => {
      const clientA = await makeClient({ name: 'Sync Scope A' });
      const clientB = await makeClient({ name: 'Sync Scope B' });
      await recordSyncRun({ clientId: clientA.id, startedAt: new Date('2026-06-01T00:00:00Z'), finishedAt: new Date(), status: 'success', rowsUpserted: 1, errorMessage: null });
      await recordSyncRun({ clientId: clientA.id, startedAt: new Date('2026-06-02T00:00:00Z'), finishedAt: new Date(), status: 'success', rowsUpserted: 1, errorMessage: null });
      await recordSyncRun({ clientId: clientB.id, startedAt: new Date('2026-06-01T00:00:00Z'), finishedAt: new Date(), status: 'success', rowsUpserted: 1, errorMessage: null });

      const runsForA = await listRecentSyncRuns(clientA.id);
      expect(runsForA).toHaveLength(2);
      expect(new Date(runsForA[0].startedAt).getTime()).toBeGreaterThan(new Date(runsForA[1].startedAt).getTime());
    });
  });

  describe('upsertMetaCampaignDailyMetrics', () => {
    it('inserts new daily rows and returns the upserted count', async () => {
      const client = await makeClient();
      const count = await upsertMetaCampaignDailyMetrics(client.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'Spring Sale', status: 'active', date: '2026-06-01', spend: 100, impressions: 1000, clicks: 50, leads: 5, reach: null },
        { metaCampaignId: 'camp-1', campaignName: 'Spring Sale', status: 'active', date: '2026-06-02', spend: 120, impressions: 1100, clicks: 55, leads: 6, reach: null },
      ]);
      expect(count).toBe(2);

      const rows = await query('SELECT * FROM meta_campaign_daily_metrics WHERE client_id = $1 ORDER BY date', [client.id]);
      expect(rows.rowCount).toBe(2);
    });

    it('UPSERTs on (client_id, meta_campaign_id, date): a revised same-day value overwrites, never duplicates', async () => {
      const client = await makeClient();
      await upsertMetaCampaignDailyMetrics(client.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'Spring Sale', status: 'active', date: '2026-06-01', spend: 100, impressions: 1000, clicks: 50, leads: 5, reach: null },
      ]);
      await upsertMetaCampaignDailyMetrics(client.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'Spring Sale', status: 'active', date: '2026-06-01', spend: 137.5, impressions: 1050, clicks: 53, leads: 6, reach: 900 },
      ]);

      const rows = await query('SELECT spend, impressions, clicks, leads, reach FROM meta_campaign_daily_metrics WHERE client_id = $1 AND meta_campaign_id = $2 AND date = $3', [
        client.id,
        'camp-1',
        '2026-06-01',
      ]);
      expect(rows.rowCount).toBe(1);
      expect(Number(rows.rows[0].spend)).toBe(137.5);
      expect(Number(rows.rows[0].leads)).toBe(6);
      expect(Number(rows.rows[0].reach)).toBe(900);
    });

    it('UPSERT also refreshes campaign_name/status when Meta renames or pauses a campaign', async () => {
      const client = await makeClient();
      await upsertMetaCampaignDailyMetrics(client.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'Old Name', status: 'active', date: '2026-06-01', spend: 10, impressions: 100, clicks: 5, leads: 1, reach: null },
      ]);
      await upsertMetaCampaignDailyMetrics(client.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'New Name', status: 'paused', date: '2026-06-01', spend: 10, impressions: 100, clicks: 5, leads: 1, reach: null },
      ]);
      const row = await query('SELECT campaign_name, status FROM meta_campaign_daily_metrics WHERE client_id = $1 AND meta_campaign_id = $2 AND date = $3', [
        client.id,
        'camp-1',
        '2026-06-01',
      ]);
      expect(row.rows[0]).toEqual({ campaign_name: 'New Name', status: 'paused' });
    });

    it('cross-client isolation: the same meta_campaign_id + date for two different clients never collides', async () => {
      const clientA = await makeClient({ name: 'Isolation A' });
      const clientB = await makeClient({ name: 'Isolation B' });
      await upsertMetaCampaignDailyMetrics(clientA.id, null, [
        { metaCampaignId: 'shared-camp-id', campaignName: 'A Campaign', status: 'active', date: '2026-06-01', spend: 10, impressions: 100, clicks: 5, leads: 1, reach: null },
      ]);
      await upsertMetaCampaignDailyMetrics(clientB.id, null, [
        { metaCampaignId: 'shared-camp-id', campaignName: 'B Campaign', status: 'active', date: '2026-06-01', spend: 999, impressions: 999, clicks: 99, leads: 9, reach: null },
      ]);
      const rowA = await query('SELECT spend FROM meta_campaign_daily_metrics WHERE client_id = $1', [clientA.id]);
      expect(Number(rowA.rows[0].spend)).toBe(10);
    });
  });

  describe('reporting: getMetaCampaignSummaries / getMetaSpendSummary / getMetaSpendSummaryByClient', () => {
    it('returns null spend summary when the client has zero rows — never a fabricated zero', async () => {
      const client = await makeClient();
      expect(await getMetaSpendSummary({ clientId: client.id })).toBeNull();
      expect(await getMetaCampaignSummaries({ clientId: client.id })).toEqual([]);
    });

    it('aggregates daily rows into a period summary with null-safe CTR/CPC/CPL', async () => {
      const client = await makeClient();
      await upsertMetaCampaignDailyMetrics(client.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'Camp 1', status: 'active', date: '2026-06-01', spend: 100, impressions: 1000, clicks: 50, leads: 5, reach: 800 },
        { metaCampaignId: 'camp-1', campaignName: 'Camp 1', status: 'active', date: '2026-06-02', spend: 100, impressions: 1000, clicks: 50, leads: 5, reach: 800 },
        { metaCampaignId: 'camp-2', campaignName: 'Camp 2 (zero leads)', status: 'paused', date: '2026-06-01', spend: 50, impressions: 500, clicks: 0, leads: 0, reach: null },
      ]);

      const summary = await getMetaSpendSummary({ clientId: client.id });
      expect(summary).toMatchObject({ spend: 250, impressions: 2500, clicks: 100, leads: 10 });
      expect(summary?.ctr).toBeCloseTo(100 / 2500);
      expect(summary?.cpc).toBeCloseTo(2.5);
      expect(summary?.cpl).toBeCloseTo(25);
      expect(summary?.reach).toBe(1600); // additive daily reach, explicitly labelled as such in the UI

      const campaigns = await getMetaCampaignSummaries({ clientId: client.id });
      const camp1 = campaigns.find((c) => c.metaCampaignId === 'camp-1');
      const camp2 = campaigns.find((c) => c.metaCampaignId === 'camp-2');
      expect(camp1).toMatchObject({ spend: 200, impressions: 2000, clicks: 100, leads: 10 });
      expect(camp2?.cpl).toBeNull(); // zero leads (the denominator) -> null, never a fabricated 0
      expect(camp2?.cpc).toBeNull(); // zero clicks -> unknown CPC, never infinity or a fabricated 0
      expect(camp2?.ctr).toBe(0); // zero clicks over nonzero impressions IS a real 0% CTR, not "unknown"
    });

    it('date filtering excludes rows outside the requested window', async () => {
      const client = await makeClient();
      await upsertMetaCampaignDailyMetrics(client.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'In window', status: 'active', date: '2026-06-15', spend: 100, impressions: 1000, clicks: 10, leads: 1, reach: null },
        { metaCampaignId: 'camp-1', campaignName: 'Out of window', status: 'active', date: '2026-07-15', spend: 999, impressions: 999, clicks: 99, leads: 9, reach: null },
      ]);
      const summary = await getMetaSpendSummary({ clientId: client.id, dateFrom: '2026-06-01', dateTo: '2026-06-30' });
      expect(summary?.spend).toBe(100);
    });

    it('cross-client isolation: a client with no mapping never sees another client\'s spend', async () => {
      const clientA = await makeClient({ name: 'Spend Isolation A' });
      const clientB = await makeClient({ name: 'Spend Isolation B' });
      await upsertMetaCampaignDailyMetrics(clientA.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'A Camp', status: 'active', date: '2026-06-01', spend: 500, impressions: 5000, clicks: 100, leads: 10, reach: null },
      ]);
      expect(await getMetaSpendSummary({ clientId: clientB.id })).toBeNull();
    });

    it('getMetaSpendSummaryByClient returns one entry per client with data, keyed by clientId', async () => {
      const clientA = await makeClient({ name: 'By Client A' });
      const clientB = await makeClient({ name: 'By Client B' });
      await upsertMetaCampaignDailyMetrics(clientA.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'A', status: 'active', date: '2026-06-01', spend: 100, impressions: 1000, clicks: 10, leads: 1, reach: null },
      ]);
      await upsertMetaCampaignDailyMetrics(clientB.id, null, [
        { metaCampaignId: 'camp-2', campaignName: 'B', status: 'active', date: '2026-06-01', spend: 200, impressions: 2000, clicks: 20, leads: 2, reach: null },
      ]);
      const byClient = await getMetaSpendSummaryByClient({});
      expect(byClient.get(clientA.id)?.spend).toBe(100);
      expect(byClient.get(clientB.id)?.spend).toBe(200);
    });

    it('global (no clientId) getMetaSpendSummary sums across every client', async () => {
      const clientA = await makeClient({ name: 'Global Sum A' });
      const clientB = await makeClient({ name: 'Global Sum B' });
      await upsertMetaCampaignDailyMetrics(clientA.id, null, [
        { metaCampaignId: 'camp-1', campaignName: 'A', status: 'active', date: '2026-06-01', spend: 100, impressions: 1000, clicks: 10, leads: 1, reach: null },
      ]);
      await upsertMetaCampaignDailyMetrics(clientB.id, null, [
        { metaCampaignId: 'camp-2', campaignName: 'B', status: 'active', date: '2026-06-01', spend: 200, impressions: 2000, clicks: 20, leads: 2, reach: null },
      ]);
      const summary = await getMetaSpendSummary({ dateFrom: '2026-06-01', dateTo: '2026-06-01' });
      expect(summary?.spend).toBeGreaterThanOrEqual(300);
    });
  });
});

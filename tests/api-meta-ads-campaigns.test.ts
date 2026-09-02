import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import {
  createClientMetaAccount,
  ingestMetaCampaignDailyMetrics,
  recordSyncRun,
  upsertMetaCampaignDailyMetrics,
} from '@/lib/server/meta-repo';
import { GET } from '@/app/api/meta-ads/campaigns/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('GET /api/meta-ads/campaigns (real PostgreSQL)', () => {
  const createdClientIds: string[] = [];
  const createdMetaAccountIds: string[] = [];
  const rand = () => Math.random().toString(36).slice(2);

  async function makeClient() {
    const client = await createClient({
      name: 'Meta Campaigns API Test Client',
      sector: 'Testing',
      status: 'prospect',
      service: 'Route test fixture',
      metaBudgetMonthly: 0,
      startDate: '2026-01-01',
      owner: 'test-suite',
    });
    createdClientIds.push(client.id);
    return client;
  }

  afterEach(async () => {
    for (const metaAdAccountId of createdMetaAccountIds.splice(0)) {
      await query('DELETE FROM meta_campaign_daily_metrics WHERE meta_ad_account_id = $1', [metaAdAccountId]);
      await query('DELETE FROM meta_sync_runs WHERE meta_ad_account_id = $1', [metaAdAccountId]);
      await query('DELETE FROM client_meta_accounts WHERE meta_ad_account_id = $1', [metaAdAccountId]);
    }
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM meta_campaign_daily_metrics WHERE client_id = $1', [id]);
      await query('DELETE FROM meta_sync_runs WHERE client_id = $1', [id]);
      await query('DELETE FROM client_meta_accounts WHERE client_id = $1', [id]);
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  afterAll(async () => {
    await closePool();
  });

  function get(qs: string) {
    return GET(new Request(`http://x/api/meta-ads/campaigns${qs}`));
  }

  it('400s on an invalid query param', async () => {
    expect((await get('?preset=not-a-real-preset')).status).toBe(400);
  });

  it('client scoped, no mapping: hasAccountMapping false, summary null, campaigns empty — honest unconfigured state', async () => {
    const client = await makeClient();
    const res = await get(`?clientId=${client.id}&preset=all`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hasAccountMapping).toBe(false);
    expect(json.hasAnyMetrics).toBe(false);
    expect(json.accountSyncs).toEqual([]);
    expect(json.summary).toBeNull();
    expect(json.campaigns).toEqual([]);
    expect(json.lastSync).toBeNull();
  });

  it('client scoped, mapped but no synced data yet: hasAccountMapping true, summary still null', async () => {
    const client = await makeClient();
    await createClientMetaAccount({ clientId: client.id, metaAdAccountId: `act_${rand()}` });

    const res = await get(`?clientId=${client.id}&preset=all`);
    const json = await res.json();
    expect(json.hasAccountMapping).toBe(true);
    expect(json.hasAnyMetrics).toBe(false);
    expect(json.summary).toBeNull();
  });

  it('client scoped, mapped with a failed sync: lastSync surfaces the real error', async () => {
    const client = await makeClient();
    await createClientMetaAccount({ clientId: client.id, metaAdAccountId: `act_${rand()}` });
    await recordSyncRun({
      clientId: client.id,
      startedAt: new Date(),
      finishedAt: new Date(),
      status: 'error',
      rowsUpserted: 0,
      errorMessage: 'Meta API rate limited',
    });

    const res = await get(`?clientId=${client.id}&preset=all`);
    const json = await res.json();
    expect(json.lastSync).toMatchObject({ status: 'error', errorMessage: 'Meta API rate limited' });
  });

  it('client scoped, mapped with real data: returns real campaign rows and summary, never demo data', async () => {
    const client = await makeClient();
    await createClientMetaAccount({ clientId: client.id, metaAdAccountId: `act_${rand()}` });
    await upsertMetaCampaignDailyMetrics(client.id, null, [
      { metaCampaignId: 'camp-1', campaignName: 'Real Campaign', status: 'active', date: '2026-06-01', spend: 150, impressions: 3000, clicks: 90, leads: 12, reach: null },
    ]);

    const res = await get(`?clientId=${client.id}&preset=all`);
    const json = await res.json();
    expect(json.summary).toMatchObject({ spend: 150, impressions: 3000, clicks: 90, leads: 12 });
    expect(json.summary.cpc).toBeCloseTo(150 / 90);
    expect(json.hasAnyMetrics).toBe(true);
    expect(json.campaigns).toHaveLength(1);
    expect(json.campaigns[0]).toMatchObject({ metaCampaignId: 'camp-1', campaignName: 'Real Campaign', spend: 150 });
  });

  it('client isolation: one client never sees another client\'s campaigns or spend', async () => {
    const clientA = await makeClient();
    const clientB = await makeClient();
    await createClientMetaAccount({ clientId: clientA.id, metaAdAccountId: `act_${rand()}` });
    await upsertMetaCampaignDailyMetrics(clientA.id, null, [
      { metaCampaignId: 'camp-a', campaignName: 'A Only', status: 'active', date: '2026-06-01', spend: 500, impressions: 5000, clicks: 50, leads: 5, reach: null },
    ]);

    const res = await get(`?clientId=${clientB.id}&preset=all`);
    const json = await res.json();
    expect(json.summary).toBeNull();
    expect(json.campaigns).toEqual([]);
  });

  it('global (no clientId): byClient breaks down spend per client', async () => {
    const clientA = await makeClient();
    const clientB = await makeClient();
    await upsertMetaCampaignDailyMetrics(clientA.id, null, [
      { metaCampaignId: 'camp-a', campaignName: 'A', status: 'active', date: '2026-06-01', spend: 100, impressions: 1000, clicks: 10, leads: 1, reach: null },
    ]);
    await upsertMetaCampaignDailyMetrics(clientB.id, null, [
      { metaCampaignId: 'camp-b', campaignName: 'B', status: 'active', date: '2026-06-01', spend: 200, impressions: 2000, clicks: 20, leads: 2, reach: null },
    ]);

    const res = await get('?preset=all');
    const json = await res.json();
    const rowA = json.byClient.find((r: { clientId: string }) => r.clientId === clientA.id);
    const rowB = json.byClient.find((r: { clientId: string }) => r.clientId === clientB.id);
    expect(rowA.summary.spend).toBe(100);
    expect(rowB.summary.spend).toBe(200);
  });

  it('internal reporting is explicit and never leaks into the client portfolio', async () => {
    const accountId = `act_internal_${rand()}`;
    createdMetaAccountIds.push(accountId);
    const account = await createClientMetaAccount({ ownerScope: 'internal', clientId: null, metaAdAccountId: accountId });
    const run = await recordSyncRun({
      clientId: null,
      metaAdAccountId: accountId,
      metaAccountId: account.id,
      startedAt: new Date(),
      finishedAt: null,
      status: 'running',
      rowsUpserted: 0,
      errorMessage: null,
    });
    await ingestMetaCampaignDailyMetrics(account, run.id, [
      { metaCampaignId: 'internal-campaign', campaignName: 'REKREATIVE', status: 'ACTIVE', date: '2026-06-01', spend: 75, impressions: 750, clicks: 25, leads: 3, reach: 600 },
    ]);

    const internal = await (await get('?ownerScope=internal&preset=all')).json();
    expect(internal.summary).toMatchObject({ spend: 75, leads: 3 });
    expect(internal.campaigns[0]).toMatchObject({ metaAdAccountId: accountId, metaCampaignId: 'internal-campaign' });

    const portfolio = await (await get('?preset=all')).json();
    expect(portfolio.campaigns.some((item: { metaAdAccountId: string | null }) => item.metaAdAccountId === accountId)).toBe(false);
    expect(portfolio.byClient.some((item: { clientId: string | null }) => item.clientId === null)).toBe(false);
  });

  it('filters one authorized account and keeps the same campaign id independent across accounts', async () => {
    const accountIdA = `act_internal_a_${rand()}`;
    const accountIdB = `act_internal_b_${rand()}`;
    createdMetaAccountIds.push(accountIdA, accountIdB);
    const accountA = await createClientMetaAccount({ ownerScope: 'internal', clientId: null, metaAdAccountId: accountIdA, label: 'Internal A' });
    const accountB = await createClientMetaAccount({ ownerScope: 'internal', clientId: null, metaAdAccountId: accountIdB, label: 'Internal B' });

    for (const [account, spend] of [[accountA, 10], [accountB, 20]] as const) {
      const run = await recordSyncRun({
        clientId: null,
        metaAdAccountId: account.metaAdAccountId,
        metaAccountId: account.id,
        startedAt: new Date(),
        finishedAt: null,
        status: 'running',
        rowsUpserted: 0,
        errorMessage: null,
      });
      await ingestMetaCampaignDailyMetrics(account, run.id, [
        { metaCampaignId: 'shared-campaign-id', campaignName: account.label ?? 'Campaign', status: 'ACTIVE', date: '2026-06-01', spend, impressions: 100, clicks: 10, leads: 1, reach: 80 },
      ]);
    }

    const all = await (await get('?ownerScope=internal&preset=all')).json();
    expect(all.campaigns.filter((item: { metaCampaignId: string }) => item.metaCampaignId === 'shared-campaign-id')).toHaveLength(2);
    expect(all.summary.spend).toBe(30);
    expect(all.accountSyncs).toHaveLength(2);

    const selected = await (await get(`?ownerScope=internal&metaAdAccountId=${accountIdA}&preset=all`)).json();
    expect(selected.campaigns).toHaveLength(1);
    expect(selected.campaigns[0]).toMatchObject({ metaAdAccountId: accountIdA, spend: 10 });
    expect(selected.summary.spend).toBe(10);
    expect(selected.lastSync).toMatchObject({ status: 'success', rowsUpserted: 1 });
  });
});

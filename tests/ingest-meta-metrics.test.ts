import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkMetaIngestAuth } from '@/lib/server/meta-ingest-auth';
import { closePool, query } from '@/lib/server/db';
import { createClient } from '@/lib/server/clients-repo';
import { createClientMetaAccount } from '@/lib/server/meta-repo';
import { POST } from '@/app/api/ingest/meta-metrics/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

// ── Pure auth unit tests — no DB needed, always run ─────────────────────
describe('checkMetaIngestAuth (route-level sanity)', () => {
  const originalKey = process.env.INGEST_META_API_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.INGEST_META_API_KEY;
    else process.env.INGEST_META_API_KEY = originalKey;
  });

  it('fails closed when unset', () => {
    delete process.env.INGEST_META_API_KEY;
    expect(checkMetaIngestAuth(new Request('http://x', { method: 'POST' }))).toEqual({ ok: false, reason: 'not_configured' });
  });
});

// ── Integration tests against a real Postgres test database ─────────────
// Requires an explicit TEST_DATABASE_URL (see tests/helpers/pg-test-env.ts)
// - never DATABASE_URL/.env.local, which may be production.
const TEST_DATABASE_URL = installTestDatabaseUrl();
const TEST_META_INGEST_KEY = 'test-meta-ingest-key-for-vitest';

describe.runIf(Boolean(TEST_DATABASE_URL))('POST /api/ingest/meta-metrics (real PostgreSQL)', () => {
  const originalKey = process.env.INGEST_META_API_KEY;
  const createdClientIds: string[] = [];
  const rand = () => Math.random().toString(36).slice(2);
  // The "unmapped account" tests below deliberately record a
  // client_id=NULL meta_sync_runs row (see route.ts) — not scoped to any
  // tracked client id, so it needs its own cleanup or it leaks into the
  // shared dev database forever and poisons every later unscoped
  // getLatestSyncRun() call (ops-status's meta_ads connection reads
  // globally). Scoped by this suite's own start time, never a client's rows.
  const suiteStartedAt = new Date();

  beforeAll(() => {
    process.env.INGEST_META_API_KEY = TEST_META_INGEST_KEY;
  });

  afterAll(async () => {
    if (originalKey === undefined) delete process.env.INGEST_META_API_KEY;
    else process.env.INGEST_META_API_KEY = originalKey;
    await query('DELETE FROM meta_sync_runs WHERE client_id IS NULL AND started_at >= $1', [suiteStartedAt]);
    await closePool();
  });

  afterEach(async () => {
    for (const id of createdClientIds.splice(0)) {
      await query('DELETE FROM meta_campaign_daily_metrics WHERE client_id = $1', [id]);
      await query('DELETE FROM meta_sync_runs WHERE client_id = $1', [id]);
      await query('DELETE FROM client_meta_accounts WHERE client_id = $1', [id]);
      await query('DELETE FROM clients WHERE id = $1', [id]);
    }
  });

  async function makeClient() {
    const client = await createClient({
      name: 'Meta Ingest Test Client',
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

  function post(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TEST_META_INGEST_KEY}` }) {
    return POST(new Request('http://x/api/ingest/meta-metrics', { method: 'POST', headers, body: JSON.stringify(body) }));
  }

  const baseRow = (overrides: Record<string, unknown> = {}) => ({
    metaCampaignId: 'camp-1',
    campaignName: 'Test Campaign',
    status: 'active',
    date: '2026-06-01',
    spend: 100,
    impressions: 1000,
    clicks: 50,
    leads: 5,
    ...overrides,
  });

  describe('auth', () => {
    it('401s on a missing auth header', async () => {
      expect((await post({ metaAdAccountId: 'act_x', rows: [baseRow()] }, {})).status).toBe(401);
    });

    it('401s on the wrong token', async () => {
      expect((await post({ metaAdAccountId: 'act_x', rows: [baseRow()] }, { authorization: 'Bearer wrong' })).status).toBe(401);
    });

    it('fails closed (500) when INGEST_META_API_KEY is unset, even with a token sent', async () => {
      delete process.env.INGEST_META_API_KEY;
      try {
        expect((await post({ metaAdAccountId: 'act_x', rows: [baseRow()] })).status).toBe(500);
      } finally {
        process.env.INGEST_META_API_KEY = TEST_META_INGEST_KEY;
      }
    });

    it('a valid INGEST_API_KEY (leads ingestion) does not authenticate this endpoint', async () => {
      const originalIngestKey = process.env.INGEST_API_KEY;
      process.env.INGEST_API_KEY = 'leads-key';
      try {
        expect((await post({ metaAdAccountId: 'act_x', rows: [baseRow()] }, { authorization: 'Bearer leads-key' })).status).toBe(401);
      } finally {
        if (originalIngestKey === undefined) delete process.env.INGEST_API_KEY;
        else process.env.INGEST_API_KEY = originalIngestKey;
      }
    });
  });

  describe('validation', () => {
    it('400s on a missing metaAdAccountId', async () => {
      expect((await post({ rows: [baseRow()] })).status).toBe(400);
    });

    it('400s on an empty rows array', async () => {
      expect((await post({ metaAdAccountId: 'act_x', rows: [] })).status).toBe(400);
    });

    it('400s on a malformed date', async () => {
      expect((await post({ metaAdAccountId: 'act_x', rows: [baseRow({ date: '06-01-2026' })] })).status).toBe(400);
    });

    it('400s on a negative spend', async () => {
      expect((await post({ metaAdAccountId: 'act_x', rows: [baseRow({ spend: -5 })] })).status).toBe(400);
    });

    it('400s on an unknown extra field — strict schema', async () => {
      expect((await post({ metaAdAccountId: 'act_x', rows: [baseRow()], extra: 'nope' })).status).toBe(400);
    });
  });

  describe('client resolution', () => {
    it('422s on an unmapped Meta ad account, and never guesses a client', async () => {
      const res = await post({ metaAdAccountId: `act_unmapped_${rand()}`, rows: [baseRow()] });
      expect(res.status).toBe(422);
    });

    it('records a failed sync run (clientId null) for an unmapped account', async () => {
      const accountId = `act_unmapped_${rand()}`;
      await post({ metaAdAccountId: accountId, rows: [baseRow()] });
      const run = await query('SELECT status, client_id, error_message FROM meta_sync_runs WHERE client_id IS NULL ORDER BY started_at DESC LIMIT 1');
      expect(run.rows[0]).toMatchObject({ status: 'error', client_id: null });
    });

    it('a deactivated mapping is treated as unmapped', async () => {
      const client = await makeClient();
      const accountId = `act_${rand()}`;
      const account = await createClientMetaAccount({ clientId: client.id, metaAdAccountId: accountId });
      await query('UPDATE client_meta_accounts SET active = false WHERE id = $1', [account.id]);
      expect((await post({ metaAdAccountId: accountId, rows: [baseRow()] })).status).toBe(422);
    });

    it('resolves the correct client for a mapped, active ad account', async () => {
      const client = await makeClient();
      const accountId = `act_${rand()}`;
      await createClientMetaAccount({ clientId: client.id, metaAdAccountId: accountId });

      const res = await post({ metaAdAccountId: accountId, rows: [baseRow()] });
      expect(res.status).toBe(201);
      const json = (await res.json()) as { clientId: string };
      expect(json.clientId).toBe(client.id);
    });
  });

  describe('idempotent upsert', () => {
    it('a repeated POST for the same (campaign, date) overwrites, never duplicates', async () => {
      const client = await makeClient();
      const accountId = `act_${rand()}`;
      await createClientMetaAccount({ clientId: client.id, metaAdAccountId: accountId });

      await post({ metaAdAccountId: accountId, rows: [baseRow({ spend: 100, leads: 5 })] });
      const second = await post({ metaAdAccountId: accountId, rows: [baseRow({ spend: 150, leads: 7 })] });
      expect(second.status).toBe(201);

      const rows = await query('SELECT spend, leads FROM meta_campaign_daily_metrics WHERE client_id = $1', [client.id]);
      expect(rows.rowCount).toBe(1);
      expect(Number(rows.rows[0].spend)).toBe(150);
      expect(Number(rows.rows[0].leads)).toBe(7);
    });

    it('records a successful sync run with the correct rowsUpserted count', async () => {
      const client = await makeClient();
      const accountId = `act_${rand()}`;
      await createClientMetaAccount({ clientId: client.id, metaAdAccountId: accountId });

      await post({
        metaAdAccountId: accountId,
        rows: [baseRow({ metaCampaignId: 'camp-1', date: '2026-06-01' }), baseRow({ metaCampaignId: 'camp-1', date: '2026-06-02' })],
      });

      const run = await query('SELECT status, rows_upserted FROM meta_sync_runs WHERE client_id = $1 ORDER BY started_at DESC LIMIT 1', [client.id]);
      expect(run.rows[0]).toMatchObject({ status: 'success', rows_upserted: 2 });
    });
  });

  describe('security', () => {
    it('never echoes the bearer token in the response body', async () => {
      const client = await makeClient();
      const accountId = `act_${rand()}`;
      await createClientMetaAccount({ clientId: client.id, metaAdAccountId: accountId });
      const res = await post({ metaAdAccountId: accountId, rows: [baseRow()] });
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain(TEST_META_INGEST_KEY);
    });
  });
});

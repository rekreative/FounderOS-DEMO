import { beforeEach, describe, expect, it, vi } from 'vitest';

const transactionClient = { query: vi.fn() };
const withTransaction = vi.fn(async (callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));

vi.mock('@/lib/server/db', () => ({
  query: vi.fn(),
  withTransaction: (...args: unknown[]) => withTransaction(...(args as [(client: typeof transactionClient) => Promise<unknown>])),
}));

const { ingestMetaCampaignDailyMetrics, MetaOwnershipResolutionError } = await import('@/lib/server/meta-repo');

const account = {
  id: 'mapping-current',
  ownerScope: 'client' as const,
  clientId: 'client-current',
  metaAdAccountId: '3704368926499756',
  metaPageId: null,
  metaFormIds: null,
  label: null,
  active: true,
  validFrom: '2026-07-01',
  validTo: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const row = {
  metaCampaignId: 'campaign-1',
  campaignName: 'Campaign',
  status: 'ACTIVE',
  date: '2026-08-31',
  spend: 10,
  impressions: 100,
  clicks: 5,
  leads: 1,
  reach: 80,
};

const ownershipRow = {
  id: 'mapping-effective',
  owner_scope: 'client',
  client_id: 'client-effective',
  meta_ad_account_id: account.metaAdAccountId,
  meta_page_id: null,
  meta_form_ids: null,
  label: null,
  active: true,
  valid_from: '2026-01-01',
  valid_to: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('canonical Meta ingestion transaction', () => {
  it('writes canonical facts and marks success inside one transaction', async () => {
    transactionClient.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [ownershipRow] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] });

    await expect(ingestMetaCampaignDailyMetrics(account, 'sync-1', [row])).resolves.toBe(1);
    expect(withTransaction).toHaveBeenCalledTimes(1);

    const insertSql = transactionClient.query.mock.calls[1][0] as string;
    expect(insertSql).toContain('ON CONFLICT (meta_ad_account_id, meta_campaign_id, date)');
    expect(transactionClient.query.mock.calls[1][1]).toEqual(expect.arrayContaining([
      ownershipRow.client_id,
      account.metaAdAccountId,
      ownershipRow.id,
      row.metaCampaignId,
      'sync-1',
    ]));

    const completionSql = transactionClient.query.mock.calls[2][0] as string;
    expect(completionSql).toContain("SET status = 'success'");
    expect(completionSql).toContain("status = 'running'");
  });

  it('does not attempt success when a metric write fails', async () => {
    transactionClient.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [ownershipRow] })
      .mockRejectedValueOnce(new Error('write failed'));

    await expect(ingestMetaCampaignDailyMetrics(account, 'sync-1', [row])).rejects.toThrow('write failed');
    expect(transactionClient.query).toHaveBeenCalledTimes(2);
    expect(transactionClient.query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'success'"))).toBe(false);
  });

  it('rejects an uncovered or ambiguous date before writing a metric', async () => {
    transactionClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(ingestMetaCampaignDailyMetrics(account, 'sync-1', [row])).rejects.toBeInstanceOf(MetaOwnershipResolutionError);
    expect(transactionClient.query).toHaveBeenCalledTimes(1);
  });
});

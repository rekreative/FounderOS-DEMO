import { beforeEach, describe, expect, it, vi } from 'vitest';

const getActiveAccount = vi.fn();
const recordSyncRun = vi.fn();
const ingestMetrics = vi.fn();
const markRunError = vi.fn();

class MetaOwnershipResolutionError extends Error {}

vi.mock('@/lib/server/meta-ingest-auth', () => ({
  checkMetaIngestAuth: () => ({ ok: true }),
}));

vi.mock('@/lib/server/meta-repo', () => ({
  getActiveClientMetaAccountByAdAccountId: (...args: unknown[]) => getActiveAccount(...args),
  recordSyncRun: (...args: unknown[]) => recordSyncRun(...args),
  ingestMetaCampaignDailyMetrics: (...args: unknown[]) => ingestMetrics(...args),
  markMetaSyncRunError: (...args: unknown[]) => markRunError(...args),
  MetaOwnershipResolutionError,
}));

const { POST } = await import('@/app/api/ingest/meta-metrics/route');

const account = {
  id: 'meta-account-internal',
  ownerScope: 'internal' as const,
  clientId: null,
  metaAdAccountId: '3704368926499756',
  metaPageId: null,
  metaFormIds: null,
  label: 'REKREATIVE',
  active: true,
  validFrom: '2026-01-01',
  validTo: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const body = {
  metaAdAccountId: account.metaAdAccountId,
  rows: [{
    metaCampaignId: 'campaign-1',
    campaignName: 'Internal campaign',
    status: 'ACTIVE',
    date: '2026-08-31',
    spend: 10,
    impressions: 100,
    clicks: 5,
    leads: 1,
    reach: 80,
  }],
};

function request() {
  return new Request('http://x/api/ingest/meta-metrics', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveAccount.mockResolvedValue(account);
  recordSyncRun.mockResolvedValue({ id: 'sync-1' });
  ingestMetrics.mockResolvedValue(1);
  markRunError.mockResolvedValue({ id: 'sync-1', status: 'error' });
});

describe('POST /api/ingest/meta-metrics lifecycle', () => {
  it('creates running first, then ingests using the resolved internal mapping', async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, ownerScope: 'internal', clientId: null, rowsUpserted: 1 });
    expect(recordSyncRun).toHaveBeenCalledWith(expect.objectContaining({
      clientId: null,
      metaAdAccountId: account.metaAdAccountId,
      metaAccountId: account.id,
      status: 'running',
      finishedAt: null,
    }));
    expect(ingestMetrics).toHaveBeenCalledWith(account, 'sync-1', body.rows);
    expect(recordSyncRun.mock.invocationCallOrder[0]).toBeLessThan(ingestMetrics.mock.invocationCallOrder[0]);
    expect(markRunError).not.toHaveBeenCalled();
  });

  it('updates the durable running row to error after ingestion fails', async () => {
    ingestMetrics.mockRejectedValue(new Error('database detail that must not be returned'));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(markRunError).toHaveBeenCalledWith('sync-1', 'metric_ingestion_failed');
    expect(recordSyncRun).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await response.json())).not.toContain('database detail');
  });

  it('records an unmapped account as error without starting ingestion', async () => {
    getActiveAccount.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(422);
    expect(recordSyncRun).toHaveBeenCalledWith(expect.objectContaining({
      clientId: null,
      metaAdAccountId: account.metaAdAccountId,
      metaAccountId: null,
      status: 'error',
      errorMessage: 'account_unmapped_or_inactive',
    }));
    expect(ingestMetrics).not.toHaveBeenCalled();
  });

  it('never ingests if the running audit row cannot be created', async () => {
    recordSyncRun.mockRejectedValue(new Error('connection secret'));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(ingestMetrics).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain('connection secret');
  });
});

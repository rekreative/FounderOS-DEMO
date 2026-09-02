import { NextResponse } from 'next/server';
import {
  getLatestSyncRun,
  getLatestSyncRunByOwnerScope,
  getLatestSyncRunsByMetaAccountIds,
  getMetaCampaignSummaries,
  getMetaSpendSummary,
  getMetaSpendSummaryByClient,
  hasMetaMetrics,
  listClientMetaAccounts,
  type ClientMetaAccount,
  type MetaSyncRun,
} from '@/lib/server/meta-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { MetaAdsCampaignsQuerySchema } from '@/lib/server/schemas';
import { resolveResultsPeriod } from '@/lib/server/results-time';
import { requireClientAccessOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

function activeAccounts(accounts: ClientMetaAccount[]): ClientMetaAccount[] {
  return accounts.filter((account) => account.active);
}

function selectedAccountOrNull(accounts: ClientMetaAccount[], metaAdAccountId?: string): ClientMetaAccount | null {
  if (!metaAdAccountId) return null;
  return activeAccounts(accounts).find((account) => account.metaAdAccountId === metaAdAccountId) ?? null;
}

function accountSyncPayload(accounts: ClientMetaAccount[], latestByMapping: Map<string, MetaSyncRun>) {
  return activeAccounts(accounts).map((account) => ({
    metaAccountId: account.id,
    metaAdAccountId: account.metaAdAccountId,
    label: account.label,
    lastSync: latestByMapping.get(account.id) ?? null,
  }));
}

/**
 * GET /api/meta-ads/campaigns
 * GET /api/meta-ads/campaigns?clientId=client-acme
 * GET /api/meta-ads/campaigns?preset=this_month | last_month | last_30_days | custom
 *
 * The real PostgreSQL read side of Meta Ads Real V1 — global (no clientId)
 * and client-scoped (ClientMetaAdsPanel) both call this one endpoint.
 * Tenant-aware: internal may omit clientId for the global/byClient view; a
 * client-role caller must pass a clientId it holds a grant for — omitting
 * it is rejected, never falls through to the global byClient breakdown.
 * Reuses lib/server/results-time.ts's period resolver so "this month" means
 * the exact same Madrid-anchored window Results uses. Every number is real
 * or explicitly null — no demo/localStorage MetaCampaign data reaches this
 * route. `hasAccountMapping` is what lets the client tab distinguish "Meta
 * Ads no configurado" from "configurado, sin datos sincronizados todavía"
 * even when `summary` is null in both cases.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = MetaAdsCampaignsQuerySchema.safeParse({
    clientId: url.searchParams.get('clientId') ?? undefined,
    ownerScope: url.searchParams.get('ownerScope') ?? undefined,
    metaAdAccountId: url.searchParams.get('metaAdAccountId') ?? undefined,
    preset: url.searchParams.get('preset') ?? undefined,
    start: url.searchParams.get('start') ?? undefined,
    end: url.searchParams.get('end') ?? undefined,
  });
  if (!parsed.success) return jsonError(400, 'invalid query parameters', { issues: parsed.error.flatten() });

  const auth = await requireClientAccessOrResponse(parsed.data.clientId);
  if ('response' in auth) return auth.response;

  const { clientId, ownerScope, metaAdAccountId, preset, start, end } = parsed.data;
  const period = resolveResultsPeriod(preset ?? 'all', start && end ? { start, end } : undefined);
  const dateFrom = period.start ?? undefined;
  const dateTo = period.end ?? undefined;

  try {
    if (clientId) {
      const accounts = await listClientMetaAccounts(clientId);
      const selectedAccount = selectedAccountOrNull(accounts, metaAdAccountId);
      if (metaAdAccountId && !selectedAccount) return jsonError(404, 'Meta account not found');
      const scope = { clientId, metaAdAccountId, dateFrom, dateTo };
      const [summary, campaigns, latestOverall, latestByMapping, hasAnyMetrics] = await Promise.all([
        getMetaSpendSummary(scope),
        getMetaCampaignSummaries(scope),
        getLatestSyncRun(clientId),
        getLatestSyncRunsByMetaAccountIds(activeAccounts(accounts).map((account) => account.id)),
        hasMetaMetrics({ clientId, metaAdAccountId }),
      ]);
      const accountSyncs = accountSyncPayload(accounts, latestByMapping);
      return NextResponse.json({
        period,
        hasAccountMapping: accounts.some((account) => account.active),
        hasAnyMetrics,
        accounts,
        summary,
        campaigns,
        lastSync: selectedAccount ? latestByMapping.get(selectedAccount.id) ?? null : latestOverall,
        accountSyncs,
        byClient: [],
      });
    }

    if (ownerScope === 'internal') {
      const accounts = await listClientMetaAccounts(undefined, 'internal');
      const selectedAccount = selectedAccountOrNull(accounts, metaAdAccountId);
      if (metaAdAccountId && !selectedAccount) return jsonError(404, 'Meta account not found');
      const scope = { ownerScope: 'internal' as const, metaAdAccountId, dateFrom, dateTo };
      const [summary, campaigns, latestOverall, latestByMapping, hasAnyMetrics] = await Promise.all([
        getMetaSpendSummary(scope),
        getMetaCampaignSummaries(scope),
        getLatestSyncRunByOwnerScope('internal'),
        getLatestSyncRunsByMetaAccountIds(activeAccounts(accounts).map((account) => account.id)),
        hasMetaMetrics({ ownerScope: 'internal', metaAdAccountId }),
      ]);
      const accountSyncs = accountSyncPayload(accounts, latestByMapping);
      return NextResponse.json({
        period,
        ownerScope,
        hasAccountMapping: accounts.some((account) => account.active),
        hasAnyMetrics,
        accounts,
        summary,
        campaigns,
        lastSync: selectedAccount ? latestByMapping.get(selectedAccount.id) ?? null : latestOverall,
        accountSyncs,
        byClient: [],
      });
    }

    const accounts = await listClientMetaAccounts(undefined, 'client');
    const selectedAccount = selectedAccountOrNull(accounts, metaAdAccountId);
    if (metaAdAccountId && !selectedAccount) return jsonError(404, 'Meta account not found');
    const scope = { metaAdAccountId, dateFrom, dateTo };
    const [summary, campaigns, latestOverall, byClientMap, latestByMapping, hasAnyMetrics] = await Promise.all([
      getMetaSpendSummary(scope),
      getMetaCampaignSummaries(scope),
      getLatestSyncRunByOwnerScope('client'),
      getMetaSpendSummaryByClient(scope),
      getLatestSyncRunsByMetaAccountIds(activeAccounts(accounts).map((account) => account.id)),
      hasMetaMetrics({ metaAdAccountId }),
    ]);

    const byClient = [...byClientMap.entries()].map(([id, clientSummary]) => ({ clientId: id, summary: clientSummary }));

    return NextResponse.json({
      period,
      hasAccountMapping: accounts.some((account) => account.active),
      hasAnyMetrics,
      accounts,
      summary,
      campaigns,
      lastSync: selectedAccount ? latestByMapping.get(selectedAccount.id) ?? null : latestOverall,
      accountSyncs: accountSyncPayload(accounts, latestByMapping),
      byClient,
    });
  } catch (error) {
    return unexpectedError('GET /api/meta-ads/campaigns', error);
  }
}

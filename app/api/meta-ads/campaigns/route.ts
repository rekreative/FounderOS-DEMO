import { NextResponse } from 'next/server';
import {
  getLatestSyncRun,
  getMetaCampaignSummaries,
  getMetaSpendSummary,
  getMetaSpendSummaryByClient,
  listClientMetaAccounts,
} from '@/lib/server/meta-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { MetaAdsCampaignsQuerySchema } from '@/lib/server/schemas';
import { resolveResultsPeriod } from '@/lib/server/results-time';
import { requireClientAccessOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

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
    preset: url.searchParams.get('preset') ?? undefined,
    start: url.searchParams.get('start') ?? undefined,
    end: url.searchParams.get('end') ?? undefined,
  });
  if (!parsed.success) return jsonError(400, 'invalid query parameters', { issues: parsed.error.flatten() });

  const auth = await requireClientAccessOrResponse(parsed.data.clientId);
  if ('response' in auth) return auth.response;

  const { clientId, preset, start, end } = parsed.data;
  const period = resolveResultsPeriod(preset ?? 'all', start && end ? { start, end } : undefined);
  const dateFrom = period.start ?? undefined;
  const dateTo = period.end ?? undefined;

  try {
    if (clientId) {
      const [accounts, summary, campaigns, lastSync] = await Promise.all([
        listClientMetaAccounts(clientId),
        getMetaSpendSummary({ clientId, dateFrom, dateTo }),
        getMetaCampaignSummaries({ clientId, dateFrom, dateTo }),
        getLatestSyncRun(clientId),
      ]);
      return NextResponse.json({
        period,
        hasAccountMapping: accounts.some((account) => account.active),
        accounts,
        summary,
        campaigns,
        lastSync,
        byClient: [],
      });
    }

    const [accounts, summary, campaigns, lastSync, byClientMap] = await Promise.all([
      listClientMetaAccounts(),
      getMetaSpendSummary({ dateFrom, dateTo }),
      getMetaCampaignSummaries({ dateFrom, dateTo }),
      getLatestSyncRun(),
      getMetaSpendSummaryByClient({ dateFrom, dateTo }),
    ]);

    const byClient = [...byClientMap.entries()].map(([id, clientSummary]) => ({ clientId: id, summary: clientSummary }));

    return NextResponse.json({
      period,
      hasAccountMapping: accounts.some((account) => account.active),
      accounts,
      summary,
      campaigns,
      lastSync,
      byClient,
    });
  } catch (error) {
    return unexpectedError('GET /api/meta-ads/campaigns', error);
  }
}

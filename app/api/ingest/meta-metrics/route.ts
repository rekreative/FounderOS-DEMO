import { NextResponse } from 'next/server';
import { checkMetaIngestAuth, type MetaIngestAuthFailureReason } from '@/lib/server/meta-ingest-auth';
import { getActiveClientMetaAccountByAdAccountId, recordSyncRun, upsertMetaCampaignDailyMetrics } from '@/lib/server/meta-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { IngestMetaMetricsBodySchema } from '@/lib/server/schemas';

export const dynamic = 'force-dynamic';

const AUTH_ERROR_STATUS: Record<MetaIngestAuthFailureReason, number> = {
  not_configured: 500,
  missing_header: 401,
  malformed_header: 401,
  invalid_token: 401,
};

const AUTH_ERROR_MESSAGE: Record<MetaIngestAuthFailureReason, string> = {
  not_configured: 'meta metrics ingestion is not configured',
  missing_header: 'unauthorized',
  malformed_header: 'unauthorized',
  invalid_token: 'unauthorized',
};

/**
 * Central Make → REKREATIVE OS Meta Ads daily-snapshot ingestion. One
 * scenario, many clients: the payload identifies the client INDIRECTLY via
 * `metaAdAccountId`, resolved here against client_meta_accounts — Make never
 * needs to know REKREATIVE OS's internal clientId, only the Meta ad account
 * id it's already pulling Insights for.
 *
 * Auth: see lib/server/meta-ingest-auth.ts — a dedicated INGEST_META_API_KEY,
 * independent of INGEST_API_KEY/MAKE_EVENTS_API_KEY, fails closed.
 *
 * Idempotency: delegates to lib/server/meta-repo.ts's
 * upsertMetaCampaignDailyMetrics — UPSERT on (client_id, meta_campaign_id,
 * date), so a repeated/corrected delivery for the same day overwrites,
 * never duplicates.
 *
 * Every call — including an unmapped-account rejection — is recorded as one
 * meta_sync_runs row, the freshness/failure evidence the global Meta Ads
 * page and ops-status read.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = checkMetaIngestAuth(request);
  if (!auth.ok) {
    return jsonError(AUTH_ERROR_STATUS[auth.reason], AUTH_ERROR_MESSAGE[auth.reason]);
  }

  const parsed = IngestMetaMetricsBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  const startedAt = new Date();
  const { metaAdAccountId, rows } = parsed.data;

  const account = await getActiveClientMetaAccountByAdAccountId(metaAdAccountId).catch((error) => {
    console.error('[api] POST /api/ingest/meta-metrics: failed to resolve client_meta_accounts:', error);
    return undefined;
  });

  if (account === undefined) {
    return unexpectedError('POST /api/ingest/meta-metrics', new Error('client_meta_accounts lookup failed'));
  }

  if (!account) {
    await recordSyncRun({
      clientId: null,
      startedAt,
      finishedAt: new Date(),
      status: 'error',
      rowsUpserted: 0,
      errorMessage: `Unmapped or inactive Meta ad account: ${metaAdAccountId}`,
    });
    return jsonError(422, 'unmapped or inactive Meta ad account', { metaAdAccountId });
  }

  try {
    const rowsUpserted = await upsertMetaCampaignDailyMetrics(
      account.clientId,
      null,
      rows.map((row) => ({ ...row, reach: row.reach ?? null })),
    );
    await recordSyncRun({
      clientId: account.clientId,
      startedAt,
      finishedAt: new Date(),
      status: 'success',
      rowsUpserted,
      errorMessage: null,
    });
    return NextResponse.json({ ok: true, clientId: account.clientId, rowsUpserted }, { status: 201 });
  } catch (error) {
    await recordSyncRun({
      clientId: account.clientId,
      startedAt,
      finishedAt: new Date(),
      status: 'error',
      rowsUpserted: 0,
      errorMessage: error instanceof Error ? error.message : 'unknown error',
    });
    return unexpectedError('POST /api/ingest/meta-metrics', error);
  }
}

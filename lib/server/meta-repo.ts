import { query, withTransaction } from './db';

/**
 * Server-only PostgreSQL repository for Meta Ads Real V1 — client_meta_accounts
 * (canonical clientId <-> Meta ad account mapping), meta_sync_runs (ingestion
 * audit trail), and meta_campaign_daily_metrics (the historical-trend
 * backbone). See lib/server/migrations/0004_meta_ads_real_v1.sql. Same
 * query()/withTransaction() convention as clients-repo.ts/leads-repo.ts.
 */

// ── client_meta_accounts ───────────────────────────────────────────────────

export type ClientMetaAccount = {
  id: string;
  clientId: string;
  metaAdAccountId: string;
  metaPageId: string | null;
  metaFormIds: string[] | null;
  label: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateClientMetaAccountInput = {
  clientId: string;
  metaAdAccountId: string;
  metaPageId?: string | null;
  metaFormIds?: string[] | null;
  label?: string | null;
  active?: boolean;
};

export type UpdateClientMetaAccountInput = Partial<{
  metaPageId: string | null;
  metaFormIds: string[] | null;
  label: string | null;
  active: boolean;
}>;

type ClientMetaAccountRow = {
  id: string;
  client_id: string;
  meta_ad_account_id: string;
  meta_page_id: string | null;
  meta_form_ids: string[] | null;
  label: string | null;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

function rowToClientMetaAccount(row: ClientMetaAccountRow): ClientMetaAccount {
  return {
    id: row.id,
    clientId: row.client_id,
    metaAdAccountId: row.meta_ad_account_id,
    metaPageId: row.meta_page_id,
    metaFormIds: row.meta_form_ids,
    label: row.label,
    active: row.active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createClientMetaAccount(input: CreateClientMetaAccountInput): Promise<ClientMetaAccount> {
  const id = generateId('meta-account');
  const result = await query<ClientMetaAccountRow>(
    `INSERT INTO client_meta_accounts (id, client_id, meta_ad_account_id, meta_page_id, meta_form_ids, label, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      input.clientId,
      input.metaAdAccountId.trim(),
      input.metaPageId?.trim() || null,
      input.metaFormIds && input.metaFormIds.length > 0 ? JSON.stringify(input.metaFormIds) : null,
      input.label?.trim() || null,
      input.active ?? true,
    ],
  );
  return rowToClientMetaAccount(result.rows[0]);
}

export async function getClientMetaAccountById(id: string): Promise<ClientMetaAccount | null> {
  const result = await query<ClientMetaAccountRow>('SELECT * FROM client_meta_accounts WHERE id = $1', [id]);
  return result.rowCount === 0 ? null : rowToClientMetaAccount(result.rows[0]);
}

/** The ingestion route's client-resolution lookup — only an ACTIVE mapping
 *  resolves; a deactivated/reassigned account id is treated as unmapped. */
export async function getActiveClientMetaAccountByAdAccountId(metaAdAccountId: string): Promise<ClientMetaAccount | null> {
  const result = await query<ClientMetaAccountRow>(
    'SELECT * FROM client_meta_accounts WHERE meta_ad_account_id = $1 AND active = true',
    [metaAdAccountId],
  );
  return result.rowCount === 0 ? null : rowToClientMetaAccount(result.rows[0]);
}

/** No clientId -> every mapping. A clientId -> only that client's own mappings. */
export async function listClientMetaAccounts(clientId?: string): Promise<ClientMetaAccount[]> {
  const result = clientId
    ? await query<ClientMetaAccountRow>('SELECT * FROM client_meta_accounts WHERE client_id = $1 ORDER BY created_at DESC', [clientId])
    : await query<ClientMetaAccountRow>('SELECT * FROM client_meta_accounts ORDER BY created_at DESC');
  return result.rows.map(rowToClientMetaAccount);
}

const UPDATABLE_ACCOUNT_FIELDS: Array<{ key: keyof UpdateClientMetaAccountInput; column: string; toDb: (value: unknown) => unknown }> = [
  { key: 'metaPageId', column: 'meta_page_id', toDb: (v) => (v ? (v as string).trim() : null) },
  { key: 'metaFormIds', column: 'meta_form_ids', toDb: (v) => (v && (v as string[]).length > 0 ? JSON.stringify(v) : null) },
  { key: 'label', column: 'label', toDb: (v) => (v ? (v as string).trim() : null) },
  { key: 'active', column: 'active', toDb: (v) => v },
];

/** clientId and metaAdAccountId are immutable — see the schema/module doc
 *  comment for why (re-mapping goes through deactivate + create, not update). */
export async function updateClientMetaAccount(id: string, patch: UpdateClientMetaAccountInput): Promise<ClientMetaAccount | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const { key, column, toDb } of UPDATABLE_ACCOUNT_FIELDS) {
    if (!(key in patch)) continue;
    values.push(toDb(patch[key]));
    setClauses.push(`${column} = $${values.length}`);
  }

  if (setClauses.length === 0) return getClientMetaAccountById(id);

  values.push(id);
  const result = await query<ClientMetaAccountRow>(
    `UPDATE client_meta_accounts SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return result.rowCount === 0 ? null : rowToClientMetaAccount(result.rows[0]);
}

// ── meta_sync_runs ──────────────────────────────────────────────────────────

export type MetaSyncRunStatus = 'success' | 'partial' | 'error';

export type MetaSyncRun = {
  id: string;
  clientId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: MetaSyncRunStatus;
  rowsUpserted: number;
  errorMessage: string | null;
  source: string;
};

export type RecordSyncRunInput = {
  clientId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  status: MetaSyncRunStatus;
  rowsUpserted: number;
  errorMessage: string | null;
  source?: string;
};

type MetaSyncRunRow = {
  id: string;
  client_id: string | null;
  started_at: Date;
  finished_at: Date | null;
  status: string;
  rows_upserted: number;
  error_message: string | null;
  source: string;
};

function rowToSyncRun(row: MetaSyncRunRow): MetaSyncRun {
  return {
    id: row.id,
    clientId: row.client_id,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    status: row.status as MetaSyncRunStatus,
    rowsUpserted: row.rows_upserted,
    errorMessage: row.error_message,
    source: row.source,
  };
}

/** One row per POST /api/ingest/meta-metrics call — the request is
 *  synchronous end-to-end, so the run is recorded once, after processing
 *  completes, rather than as a separate start/finish pair. */
export async function recordSyncRun(input: RecordSyncRunInput): Promise<MetaSyncRun> {
  const id = generateId('meta-sync');
  const result = await query<MetaSyncRunRow>(
    `INSERT INTO meta_sync_runs (id, client_id, started_at, finished_at, status, rows_upserted, error_message, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, input.clientId, input.startedAt, input.finishedAt, input.status, input.rowsUpserted, input.errorMessage, input.source ?? 'make'],
  );
  return rowToSyncRun(result.rows[0]);
}

/** Most recently STARTED run — not most recently inserted (those coincide in
 *  practice, since runs are recorded synchronously, but ordering by
 *  started_at is what "freshness" actually means). clientId omitted ->
 *  the most recent run across every client (global page). */
export async function getLatestSyncRun(clientId?: string): Promise<MetaSyncRun | null> {
  const result = clientId
    ? await query<MetaSyncRunRow>('SELECT * FROM meta_sync_runs WHERE client_id = $1 ORDER BY started_at DESC LIMIT 1', [clientId])
    : await query<MetaSyncRunRow>('SELECT * FROM meta_sync_runs ORDER BY started_at DESC LIMIT 1');
  return result.rowCount === 0 ? null : rowToSyncRun(result.rows[0]);
}

export async function listRecentSyncRuns(clientId?: string, limit = 10): Promise<MetaSyncRun[]> {
  const result = clientId
    ? await query<MetaSyncRunRow>('SELECT * FROM meta_sync_runs WHERE client_id = $1 ORDER BY started_at DESC LIMIT $2', [clientId, limit])
    : await query<MetaSyncRunRow>('SELECT * FROM meta_sync_runs ORDER BY started_at DESC LIMIT $1', [limit]);
  return result.rows.map(rowToSyncRun);
}

// ── meta_campaign_daily_metrics ────────────────────────────────────────────

export type DailyMetricRowInput = {
  metaCampaignId: string;
  campaignName: string;
  status: string;
  /** YYYY-MM-DD */
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  reach: number | null;
};

/**
 * Idempotent UPSERT on (client_id, meta_campaign_id, date) — see the unique
 * constraint in migration 0004. A repeated delivery for the same day
 * OVERWRITES spend/impressions/clicks/leads/reach/campaign_name/status with
 * the latest values (Meta's own attribution corrections up to ~28 days
 * out), never inserts a duplicate. All rows for one call share `syncRunId`
 * (nullable — tests may upsert without a run). Runs inside one transaction:
 * a partial failure never leaves half a day's rows written.
 */
export async function upsertMetaCampaignDailyMetrics(
  clientId: string,
  syncRunId: string | null,
  rows: DailyMetricRowInput[],
): Promise<number> {
  if (rows.length === 0) return 0;

  return withTransaction(async (client) => {
    let count = 0;
    for (const row of rows) {
      const id = generateId('meta-metric');
      await client.query(
        `INSERT INTO meta_campaign_daily_metrics (
           id, client_id, meta_campaign_id, campaign_name, status, date,
           spend, impressions, clicks, leads, reach, sync_run_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (client_id, meta_campaign_id, date) DO UPDATE SET
           campaign_name = EXCLUDED.campaign_name,
           status = EXCLUDED.status,
           spend = EXCLUDED.spend,
           impressions = EXCLUDED.impressions,
           clicks = EXCLUDED.clicks,
           leads = EXCLUDED.leads,
           reach = EXCLUDED.reach,
           sync_run_id = EXCLUDED.sync_run_id,
           updated_at = now()`,
        [id, clientId, row.metaCampaignId, row.campaignName, row.status, row.date, row.spend, row.impressions, row.clicks, row.leads, row.reach, syncRunId],
      );
      count += 1;
    }
    return count;
  });
}

// ── Reporting (aggregated from the daily rows — never a separate rollup table) ──

export type MetaCampaignSummary = {
  metaCampaignId: string;
  /** Most recent day's name/status within the queried window — Meta renames
   *  or pauses a campaign going forward, never retroactively. */
  campaignName: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  reach: number | null;
  ctr: number | null;
  cpl: number | null;
};

export type MetaSpendSummary = {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  reach: number | null;
  ctr: number | null;
  cpl: number | null;
};

export type MetaReportingQuery = {
  clientId?: string;
  /** Inclusive YYYY-MM-DD lower bound on `date` (a plain calendar date, same
   *  as lib/server/results-time.ts's ResolvedResultsPeriod.start — never a
   *  UTC instant, so no timezone-shift risk comparing against it). Omitted
   *  = unbounded. */
  dateFrom?: string;
  /** Inclusive YYYY-MM-DD upper bound on `date`. Omitted = unbounded. */
  dateTo?: string;
};

function nullOnZero(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function buildReportingWhere(opts: MetaReportingQuery): { where: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.clientId) {
    params.push(opts.clientId);
    conditions.push(`client_id = $${params.length}`);
  }
  if (opts.dateFrom) {
    params.push(opts.dateFrom);
    conditions.push(`date >= $${params.length}::date`);
  }
  if (opts.dateTo) {
    params.push(opts.dateTo);
    conditions.push(`date <= $${params.length}::date`);
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

/** Per-campaign totals across the queried window, with the most recent
 *  day's name/status. Empty array (never a fabricated row) when nothing
 *  matches. */
export async function getMetaCampaignSummaries(opts: MetaReportingQuery = {}): Promise<MetaCampaignSummary[]> {
  const { where, params } = buildReportingWhere(opts);
  const result = await query<{
    meta_campaign_id: string;
    campaign_name: string;
    status: string;
    spend: string;
    impressions: string;
    clicks: string;
    leads: string;
    reach: string | null;
  }>(
    `SELECT
       meta_campaign_id,
       (array_agg(campaign_name ORDER BY date DESC))[1] AS campaign_name,
       (array_agg(status ORDER BY date DESC))[1] AS status,
       SUM(spend) AS spend,
       SUM(impressions) AS impressions,
       SUM(clicks) AS clicks,
       SUM(leads) AS leads,
       SUM(reach) AS reach
     FROM meta_campaign_daily_metrics
     ${where}
     GROUP BY meta_campaign_id
     ORDER BY SUM(spend) DESC`,
    params,
  );

  return result.rows.map((row) => {
    const spend = Number(row.spend);
    const impressions = Number(row.impressions);
    const clicks = Number(row.clicks);
    const leads = Number(row.leads);
    return {
      metaCampaignId: row.meta_campaign_id,
      campaignName: row.campaign_name,
      status: row.status,
      spend,
      impressions,
      clicks,
      leads,
      reach: row.reach == null ? null : Number(row.reach),
      ctr: nullOnZero(clicks, impressions),
      cpl: nullOnZero(spend, leads),
    };
  });
}

/** Period spend/impressions/clicks/leads totals, with null-safe CTR/CPL.
 *  Returns null (never a fabricated zero) when no rows match — "no data",
 *  whether because nothing is mapped or nothing has synced yet, is the
 *  caller's (Results/Meta Ads pages') concern, not this function's. */
export async function getMetaSpendSummary(opts: MetaReportingQuery = {}): Promise<MetaSpendSummary | null> {
  const { where, params } = buildReportingWhere(opts);
  const result = await query<{ spend: string | null; impressions: string | null; clicks: string | null; leads: string | null; reach: string | null; row_count: string }>(
    `SELECT SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(leads) AS leads, SUM(reach) AS reach, COUNT(*) AS row_count
     FROM meta_campaign_daily_metrics
     ${where}`,
    params,
  );
  const row = result.rows[0];
  if (!row || Number(row.row_count) === 0) return null;

  const spend = Number(row.spend ?? 0);
  const impressions = Number(row.impressions ?? 0);
  const clicks = Number(row.clicks ?? 0);
  const leads = Number(row.leads ?? 0);
  return {
    spend,
    impressions,
    clicks,
    leads,
    reach: row.reach == null ? null : Number(row.reach),
    ctr: nullOnZero(clicks, impressions),
    cpl: nullOnZero(spend, leads),
  };
}

/** Per-client spend summaries for the global Meta Ads page's per-client
 *  breakdown — one bounded GROUP BY query, never N+1 per client. Only
 *  clients with at least one row in the window appear (a client with no
 *  data simply has no entry, matched the same way getMetaSpendSummary
 *  returns null for a single client). */
export async function getMetaSpendSummaryByClient(opts: Omit<MetaReportingQuery, 'clientId'> = {}): Promise<Map<string, MetaSpendSummary>> {
  const { where, params } = buildReportingWhere(opts);
  const result = await query<{ client_id: string; spend: string; impressions: string; clicks: string; leads: string; reach: string | null }>(
    `SELECT client_id, SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(leads) AS leads, SUM(reach) AS reach
     FROM meta_campaign_daily_metrics
     ${where}
     GROUP BY client_id`,
    params,
  );

  const byClient = new Map<string, MetaSpendSummary>();
  for (const row of result.rows) {
    const spend = Number(row.spend);
    const impressions = Number(row.impressions);
    const clicks = Number(row.clicks);
    const leads = Number(row.leads);
    byClient.set(row.client_id, {
      spend,
      impressions,
      clicks,
      leads,
      reach: row.reach == null ? null : Number(row.reach),
      ctr: nullOnZero(clicks, impressions),
      cpl: nullOnZero(spend, leads),
    });
  }
  return byClient;
}

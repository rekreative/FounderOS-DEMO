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
  ownerScope: 'internal' | 'client';
  clientId: string | null;
  metaAdAccountId: string;
  metaPageId: string | null;
  metaFormIds: string[] | null;
  label: string | null;
  active: boolean;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateClientMetaAccountInput = {
  ownerScope?: 'internal' | 'client';
  clientId?: string | null;
  metaAdAccountId: string;
  metaPageId?: string | null;
  metaFormIds?: string[] | null;
  label?: string | null;
  active?: boolean;
  validFrom?: string;
  validTo?: string | null;
};

export type UpdateClientMetaAccountInput = Partial<{
  metaPageId: string | null;
  metaFormIds: string[] | null;
  label: string | null;
  active: boolean;
  validTo: string | null;
}>;

type ClientMetaAccountRow = {
  id: string;
  owner_scope: string;
  client_id: string | null;
  meta_ad_account_id: string;
  meta_page_id: string | null;
  meta_form_ids: string[] | null;
  label: string | null;
  active: boolean;
  valid_from: string;
  valid_to: string | null;
  created_at: Date;
  updated_at: Date;
};

function rowToClientMetaAccount(row: ClientMetaAccountRow): ClientMetaAccount {
  return {
    id: row.id,
    ownerScope: row.owner_scope as 'internal' | 'client',
    clientId: row.client_id,
    metaAdAccountId: row.meta_ad_account_id,
    metaPageId: row.meta_page_id,
    metaFormIds: row.meta_form_ids,
    label: row.label,
    active: row.active,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createClientMetaAccount(input: CreateClientMetaAccountInput): Promise<ClientMetaAccount> {
  const id = generateId('meta-account');
  const ownerScope = input.ownerScope ?? 'client';
  const result = await query<ClientMetaAccountRow>(
    `INSERT INTO client_meta_accounts (
       id, owner_scope, client_id, meta_ad_account_id, meta_page_id,
       meta_form_ids, label, active, valid_from, valid_to
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       COALESCE(
         $9::date,
         CASE
           WHEN EXISTS (SELECT 1 FROM client_meta_accounts WHERE meta_ad_account_id = $4) THEN CURRENT_DATE
           ELSE '-infinity'::date
         END
       ),
       $10
     )
     RETURNING *`,
    [
      id,
      ownerScope,
      input.clientId ?? null,
      input.metaAdAccountId.trim(),
      input.metaPageId?.trim() || null,
      input.metaFormIds && input.metaFormIds.length > 0 ? JSON.stringify(input.metaFormIds) : null,
      input.label?.trim() || null,
      input.active ?? true,
      input.validFrom ?? null,
      input.validTo ?? null,
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
    `SELECT * FROM client_meta_accounts
     WHERE meta_ad_account_id = $1
       AND active = true
       AND CURRENT_DATE >= valid_from
       AND (valid_to IS NULL OR CURRENT_DATE < valid_to)`,
    [metaAdAccountId],
  );
  return result.rowCount === 0 ? null : rowToClientMetaAccount(result.rows[0]);
}

/** No filters -> every mapping (internal callers only at the route boundary). */
export async function listClientMetaAccounts(
  clientId?: string,
  ownerScope?: 'internal' | 'client',
): Promise<ClientMetaAccount[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (clientId) {
    params.push(clientId);
    conditions.push(`client_id = $${params.length}`);
  }
  if (ownerScope) {
    params.push(ownerScope);
    conditions.push(`owner_scope = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<ClientMetaAccountRow>(`SELECT * FROM client_meta_accounts ${where} ORDER BY created_at DESC`, params);
  return result.rows.map(rowToClientMetaAccount);
}

const UPDATABLE_ACCOUNT_FIELDS: Array<{ key: keyof UpdateClientMetaAccountInput; column: string; toDb: (value: unknown) => unknown }> = [
  { key: 'metaPageId', column: 'meta_page_id', toDb: (v) => (v ? (v as string).trim() : null) },
  { key: 'metaFormIds', column: 'meta_form_ids', toDb: (v) => (v && (v as string[]).length > 0 ? JSON.stringify(v) : null) },
  { key: 'label', column: 'label', toDb: (v) => (v ? (v as string).trim() : null) },
  { key: 'active', column: 'active', toDb: (v) => v },
  { key: 'validTo', column: 'valid_to', toDb: (v) => v ?? null },
];

/** clientId and metaAdAccountId are immutable — see the schema/module doc
 *  comment for why (re-mapping goes through deactivate + create, not update). */
export async function updateClientMetaAccount(id: string, patch: UpdateClientMetaAccountInput): Promise<ClientMetaAccount | null> {
  const normalizedPatch = { ...patch };
  if (normalizedPatch.active === false && !('validTo' in normalizedPatch)) {
    normalizedPatch.validTo = new Date().toISOString().slice(0, 10);
  }
  if (normalizedPatch.active === true && !('validTo' in normalizedPatch)) {
    normalizedPatch.validTo = null;
  }
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const { key, column, toDb } of UPDATABLE_ACCOUNT_FIELDS) {
    if (!(key in normalizedPatch)) continue;
    values.push(toDb(normalizedPatch[key]));
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

export type MetaSyncRunStatus = 'running' | 'success' | 'partial' | 'error';

export type MetaSyncRun = {
  id: string;
  clientId: string | null;
  metaAdAccountId: string | null;
  metaAccountId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: MetaSyncRunStatus;
  rowsUpserted: number;
  errorMessage: string | null;
  source: string;
};

export type RecordSyncRunInput = {
  clientId: string | null;
  metaAdAccountId?: string | null;
  metaAccountId?: string | null;
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
  meta_ad_account_id: string | null;
  meta_account_id: string | null;
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
    metaAdAccountId: row.meta_ad_account_id,
    metaAccountId: row.meta_account_id,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    status: row.status as MetaSyncRunStatus,
    rowsUpserted: row.rows_upserted,
    errorMessage: row.error_message,
    source: row.source,
  };
}

/** Creates the durable audit row for one POST /api/ingest/meta-metrics call.
 *  Mapped requests start as `running`; the metric transaction performs the
 *  success transition, while the route records a later error transition. */
export async function recordSyncRun(input: RecordSyncRunInput): Promise<MetaSyncRun> {
  const id = generateId('meta-sync');
  const result = await query<MetaSyncRunRow>(
    `INSERT INTO meta_sync_runs (
       id, client_id, meta_ad_account_id, meta_account_id, started_at,
       finished_at, status, rows_upserted, error_message, source
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      id,
      input.clientId,
      input.metaAdAccountId ?? null,
      input.metaAccountId ?? null,
      input.startedAt,
      input.finishedAt,
      input.status,
      input.rowsUpserted,
      input.errorMessage,
      input.source ?? 'make',
    ],
  );
  return rowToSyncRun(result.rows[0]);
}

export async function markMetaSyncRunError(id: string, errorCategory: string): Promise<MetaSyncRun | null> {
  const result = await query<MetaSyncRunRow>(
    `UPDATE meta_sync_runs
     SET status = 'error', finished_at = now(), rows_upserted = 0, error_message = $2
     WHERE id = $1
     RETURNING *`,
    [id, errorCategory],
  );
  return result.rowCount === 0 ? null : rowToSyncRun(result.rows[0]);
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

export async function getLatestSyncRunByOwnerScope(ownerScope: 'internal' | 'client'): Promise<MetaSyncRun | null> {
  const result = await query<MetaSyncRunRow>(
    `SELECT run.*
     FROM meta_sync_runs run
     JOIN client_meta_accounts account ON account.id = run.meta_account_id
     WHERE account.owner_scope = $1
     ORDER BY run.started_at DESC
     LIMIT 1`,
    [ownerScope],
  );
  return result.rowCount === 0 ? null : rowToSyncRun(result.rows[0]);
}

/** Latest durable ingestion state for every concrete ownership mapping.
 * The caller supplies already-authorized mapping ids, so account-level
 * reporting never resolves a raw Meta account id outside its owner scope. */
export async function getLatestSyncRunsByMetaAccountIds(metaAccountIds: string[]): Promise<Map<string, MetaSyncRun>> {
  if (metaAccountIds.length === 0) return new Map();
  const result = await query<MetaSyncRunRow>(
    `SELECT DISTINCT ON (meta_account_id) *
     FROM meta_sync_runs
     WHERE meta_account_id = ANY($1::text[])
     ORDER BY meta_account_id, started_at DESC`,
    [metaAccountIds],
  );
  return new Map(result.rows.map((row) => [row.meta_account_id as string, rowToSyncRun(row)]));
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

export class MetaOwnershipResolutionError extends Error {
  constructor() {
    super('No unambiguous Meta account owner exists for the metric date.');
    this.name = 'MetaOwnershipResolutionError';
  }
}

/**
 * Production ingestion path. The run already exists as `running`. Every
 * canonical Meta fact and the transition to `success` commit together. If
 * any row fails, withTransaction rolls back both the metric writes and the
 * success transition; the route then marks the durable run as `error`.
 */
export async function ingestMetaCampaignDailyMetrics(
  activeAccount: ClientMetaAccount,
  syncRunId: string,
  rows: DailyMetricRowInput[],
): Promise<number> {
  return withTransaction(async (client) => {
    let count = 0;
    for (const row of rows) {
      const ownership = await client.query<ClientMetaAccountRow>(
        `SELECT *
         FROM client_meta_accounts
         WHERE meta_ad_account_id = $1
           AND $2::date >= valid_from
           AND (valid_to IS NULL OR $2::date < valid_to)
         ORDER BY valid_from DESC
         LIMIT 2`,
        [activeAccount.metaAdAccountId, row.date],
      );
      if (ownership.rowCount !== 1) throw new MetaOwnershipResolutionError();
      const mapping = ownership.rows[0];

      const id = generateId('meta-metric');
      await client.query(
        `INSERT INTO meta_campaign_daily_metrics (
           id, client_id, meta_ad_account_id, meta_account_id,
           meta_campaign_id, campaign_name, status, date,
           spend, impressions, clicks, leads, reach, sync_run_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (meta_ad_account_id, meta_campaign_id, date)
           WHERE meta_ad_account_id IS NOT NULL
         DO UPDATE SET
           client_id = EXCLUDED.client_id,
           meta_account_id = EXCLUDED.meta_account_id,
           campaign_name = EXCLUDED.campaign_name,
           status = EXCLUDED.status,
           spend = EXCLUDED.spend,
           impressions = EXCLUDED.impressions,
           clicks = EXCLUDED.clicks,
           leads = EXCLUDED.leads,
           reach = EXCLUDED.reach,
           sync_run_id = EXCLUDED.sync_run_id,
           updated_at = now()`,
        [
          id,
          mapping.client_id,
          activeAccount.metaAdAccountId,
          mapping.id,
          row.metaCampaignId,
          row.campaignName,
          row.status,
          row.date,
          row.spend,
          row.impressions,
          row.clicks,
          row.leads,
          row.reach,
          syncRunId,
        ],
      );
      count += 1;
    }

    const completed = await client.query<MetaSyncRunRow>(
      `UPDATE meta_sync_runs
       SET status = 'success', finished_at = now(), rows_upserted = $2, error_message = NULL
       WHERE id = $1 AND status = 'running'
       RETURNING *`,
      [syncRunId, count],
    );
    if (completed.rowCount !== 1) throw new Error('Meta sync run is not in the running state.');
    return count;
  });
}

/**
 * Legacy/testing helper for historical client-only metric fixtures. New
 * ingestion must use ingestMetaCampaignDailyMetrics() so canonical account
 * identity and run ownership are always present. A repeated delivery
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
         ON CONFLICT (client_id, meta_campaign_id, date)
           WHERE meta_ad_account_id IS NULL
         DO UPDATE SET
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
  metaAdAccountId: string | null;
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
  cpc: number | null;
  cpl: number | null;
};

export type MetaSpendSummary = {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  reach: number | null;
  ctr: number | null;
  cpc: number | null;
  cpl: number | null;
};

export type MetaReportingQuery = {
  clientId?: string;
  ownerScope?: 'internal' | 'client';
  /** Canonical Meta account filter. It is always combined with clientId or
   * ownerScope by buildReportingWhere, never treated as authorization. */
  metaAdAccountId?: string;
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
  } else if (opts.ownerScope === 'internal') {
    conditions.push(`meta_account_id IN (SELECT id FROM client_meta_accounts WHERE owner_scope = 'internal')`);
  } else {
    // The unscoped dashboard remains the client portfolio. Internal agency
    // metrics are visible only when explicitly requested.
    conditions.push('client_id IS NOT NULL');
  }
  if (opts.metaAdAccountId) {
    params.push(opts.metaAdAccountId);
    conditions.push(`meta_ad_account_id = $${params.length}`);
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
    meta_ad_account_id: string | null;
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
       meta_ad_account_id,
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
     GROUP BY meta_ad_account_id, meta_campaign_id
     ORDER BY SUM(spend) DESC`,
    params,
  );

  return result.rows.map((row) => {
    const spend = Number(row.spend);
    const impressions = Number(row.impressions);
    const clicks = Number(row.clicks);
    const leads = Number(row.leads);
    return {
      metaAdAccountId: row.meta_ad_account_id,
      metaCampaignId: row.meta_campaign_id,
      campaignName: row.campaign_name,
      status: row.status,
      spend,
      impressions,
      clicks,
      leads,
      reach: row.reach == null ? null : Number(row.reach),
      ctr: nullOnZero(clicks, impressions),
      cpc: nullOnZero(spend, clicks),
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
    cpc: nullOnZero(spend, clicks),
    cpl: nullOnZero(spend, leads),
  };
}

/** Distinguishes "this account has never produced a metric" from "it has
 * history, but none inside the selected period" without fabricating zeros. */
export async function hasMetaMetrics(opts: Omit<MetaReportingQuery, 'dateFrom' | 'dateTo'> = {}): Promise<boolean> {
  const { where, params } = buildReportingWhere(opts);
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM meta_campaign_daily_metrics ${where} LIMIT 1
     ) AS exists`,
    params,
  );
  return result.rows[0]?.exists === true;
}

/** Per-client spend summaries for the global Meta Ads page's per-client
 *  breakdown — one bounded GROUP BY query, never N+1 per client. Only
 *  clients with at least one row in the window appear (a client with no
 *  data simply has no entry, matched the same way getMetaSpendSummary
 *  returns null for a single client). */
export async function getMetaSpendSummaryByClient(
  opts: Omit<MetaReportingQuery, 'clientId' | 'ownerScope'> = {},
): Promise<Map<string, MetaSpendSummary>> {
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
      cpc: nullOnZero(spend, clicks),
      cpl: nullOnZero(spend, leads),
    });
  }
  return byClient;
}

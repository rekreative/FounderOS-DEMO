-- Meta Ads Real V1: client↔Meta account mapping, sync execution audit, and
-- daily campaign snapshot metrics. Additive only — no existing column,
-- constraint, or table is changed or dropped. FK-created in dependency
-- order: client_meta_accounts -> meta_sync_runs -> meta_campaign_daily_metrics
-- (the last references meta_sync_runs(id)).

-- ── 1. client_meta_accounts ───────────────────────────────────────────────
-- The canonical clientId <-> Meta ad account mapping. This table — not
-- lib/integration-connections.ts's localStorage IntegrationConnection.externalRef
-- (demo/manual, never verified) — is the authoritative sync configuration
-- surface. A client can have more than one ad account (kept open for that,
-- even though V1 onboarding is expected to be 1:1) but never the same
-- account twice.
CREATE TABLE IF NOT EXISTS client_meta_accounts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,

  meta_ad_account_id TEXT NOT NULL,   -- e.g. 'act_9384712065'
  meta_page_id TEXT NULL,
  meta_form_ids JSONB NULL,           -- array of Meta Lead Ads form ids, optional
  label TEXT NULL,

  active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (client_id, meta_ad_account_id)
);

CREATE INDEX IF NOT EXISTS idx_client_meta_accounts_client_id ON client_meta_accounts (client_id);

-- A given Meta ad account must resolve to exactly one client — the
-- ingestion endpoint looks up client_id by meta_ad_account_id alone (see
-- app/api/ingest/meta-metrics), so two clients sharing one ad account id
-- would make that lookup ambiguous. Partial: only active mappings are
-- constrained, so a deactivated/reassigned account id can be handed to a
-- different client without deleting history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_client_meta_accounts_active_account_unique
  ON client_meta_accounts (meta_ad_account_id)
  WHERE active = true;

-- ── 2. meta_sync_runs ──────────────────────────────────────────────────────
-- One row per ingestion call (POST /api/ingest/meta-metrics) — the audit
-- trail for "did the central Make sync run, and did it succeed" that both
-- the global Meta Ads page and ops-status read for freshness/failure
-- evidence. client_id is nullable: a run is scoped to whichever ad account
-- the payload named, resolved to a client server-side; a run that fails
-- before resolving an account (e.g. unmapped account id) still gets a row
-- with client_id NULL so the failure itself isn't lost.
CREATE TABLE IF NOT EXISTS meta_sync_runs (
  id TEXT PRIMARY KEY,
  client_id TEXT NULL REFERENCES clients(id) ON DELETE RESTRICT,

  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'error')),
  rows_upserted INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  source TEXT NOT NULL DEFAULT 'make',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_sync_runs_client_id ON meta_sync_runs (client_id);
CREATE INDEX IF NOT EXISTS idx_meta_sync_runs_started_at ON meta_sync_runs (started_at);

-- ── 3. meta_campaign_daily_metrics ────────────────────────────────────────
-- The historical-trend backbone: one row per (client, Meta campaign, day).
-- Daily grain only — no adset/ad/creative rows in V1. Client/global totals
-- are derived by summing this table; no separate account-daily rollup table
-- is needed.
CREATE TABLE IF NOT EXISTS meta_campaign_daily_metrics (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,

  meta_campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  status TEXT NOT NULL,

  date DATE NOT NULL,

  spend NUMERIC NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  leads BIGINT NOT NULL DEFAULT 0,     -- Meta-attributed leads, NOT CRM leads
  reach BIGINT NULL,                   -- optional; naturally available from Insights, never required

  sync_run_id TEXT NULL REFERENCES meta_sync_runs(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The idempotent UPSERT key. Meta revises attributed spend/leads for up to
  -- ~28 days after the fact, so a repeated (client_id, meta_campaign_id,
  -- date) delivery must UPDATE the existing row's metrics, never insert a
  -- duplicate or leave the earlier, uncorrected values in place.
  UNIQUE (client_id, meta_campaign_id, date)
);

CREATE INDEX IF NOT EXISTS idx_meta_campaign_daily_metrics_client_date ON meta_campaign_daily_metrics (client_id, date);
CREATE INDEX IF NOT EXISTS idx_meta_campaign_daily_metrics_campaign ON meta_campaign_daily_metrics (meta_campaign_id);

-- ── 4. leads: additive Meta attribution identifiers ───────────────────────
-- Structured, optional counterparts to the existing free-text
-- leads.campaign/ad_creative/form. Meta's Lead Ads webhook (and Make's Lead
-- Ads trigger module) surfaces campaign_id/adset_id/ad_id/form_id on every
-- lead at no extra API cost, so these are captured now even though V1 has
-- no adset/ad-level reporting — meta_campaign_id is what lets a downstream
-- cost-per-booking/CAC join a CRM lead back to its real spend row. All four
-- are nullable and OPTIONAL on ingestion: existing Make deliveries that
-- don't send them keep working unchanged (see IngestLeadBodySchema).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_campaign_id TEXT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_adset_id TEXT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_ad_id TEXT NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_form_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_meta_campaign_id ON leads (meta_campaign_id) WHERE meta_campaign_id IS NOT NULL;

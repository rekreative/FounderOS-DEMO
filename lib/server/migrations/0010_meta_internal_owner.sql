-- Meta Ads ownership V2. Keeps the existing table names and request contract,
-- while separating the canonical Meta fact identity from REKREOS ownership.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Effective-dated ownership mappings.
ALTER TABLE client_meta_accounts
  ADD COLUMN IF NOT EXISTS owner_scope TEXT NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS valid_from DATE,
  ADD COLUMN IF NOT EXISTS valid_to DATE;

UPDATE client_meta_accounts SET owner_scope = 'client' WHERE owner_scope IS NULL;

-- Existing mappings are converted into non-overlapping half-open intervals.
-- The first known mapping owns the earlier history; every later mapping starts
-- on its creation date and closes the previous interval at that same boundary.
WITH ordered AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY meta_ad_account_id ORDER BY created_at, id) AS position,
    lead(created_at::date) OVER (PARTITION BY meta_ad_account_id ORDER BY created_at, id) AS next_start
  FROM client_meta_accounts
)
UPDATE client_meta_accounts AS account
SET
  valid_from = CASE WHEN ordered.position = 1 THEN '-infinity'::date ELSE account.created_at::date END,
  valid_to = ordered.next_start
FROM ordered
WHERE ordered.id = account.id
  AND account.valid_from IS NULL;

UPDATE client_meta_accounts
SET valid_to = updated_at::date
WHERE active = false
  AND valid_to IS NULL;

UPDATE client_meta_accounts
SET active = false
WHERE valid_to IS NOT NULL;

ALTER TABLE client_meta_accounts
  ALTER COLUMN client_id DROP NOT NULL,
  ALTER COLUMN valid_from SET DEFAULT '-infinity'::date,
  ALTER COLUMN valid_from SET NOT NULL;

ALTER TABLE client_meta_accounts
  DROP CONSTRAINT IF EXISTS client_meta_accounts_owner_scope_check,
  DROP CONSTRAINT IF EXISTS client_meta_accounts_owner_invariant_check,
  DROP CONSTRAINT IF EXISTS client_meta_accounts_valid_range_check,
  DROP CONSTRAINT IF EXISTS client_meta_accounts_active_interval_check;

ALTER TABLE client_meta_accounts
  ADD CONSTRAINT client_meta_accounts_owner_scope_check
    CHECK (owner_scope IN ('internal', 'client')),
  ADD CONSTRAINT client_meta_accounts_owner_invariant_check CHECK (
    (owner_scope = 'internal' AND client_id IS NULL) OR
    (owner_scope = 'client' AND client_id IS NOT NULL)
  ),
  ADD CONSTRAINT client_meta_accounts_valid_range_check
    CHECK (valid_to IS NULL OR valid_to >= valid_from),
  ADD CONSTRAINT client_meta_accounts_active_interval_check
    CHECK (active = false OR valid_to IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_meta_accounts_owner_identity_unique
  ON client_meta_accounts (owner_scope, COALESCE(client_id, ''), meta_ad_account_id, valid_from);

ALTER TABLE client_meta_accounts
  DROP CONSTRAINT IF EXISTS client_meta_accounts_no_overlapping_ownership;

ALTER TABLE client_meta_accounts
  ADD CONSTRAINT client_meta_accounts_no_overlapping_ownership
  EXCLUDE USING gist (
    meta_ad_account_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  );

-- 2. Sync runs identify the requested canonical account and, when resolved,
-- the exact ownership mapping used by the ingestion.
ALTER TABLE meta_sync_runs
  ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS meta_account_id TEXT NULL REFERENCES client_meta_accounts(id) ON DELETE RESTRICT;

ALTER TABLE meta_sync_runs DROP CONSTRAINT IF EXISTS meta_sync_runs_status_check;
ALTER TABLE meta_sync_runs
  ADD CONSTRAINT meta_sync_runs_status_check
  CHECK (status IN ('running', 'success', 'partial', 'error'));

CREATE INDEX IF NOT EXISTS idx_meta_sync_runs_account_started_at
  ON meta_sync_runs (meta_ad_account_id, started_at DESC);

-- 3. Canonical daily facts are unique by real Meta identity, independently
-- from whichever REKREOS ownership mapping was effective for that date.
ALTER TABLE meta_campaign_daily_metrics
  ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS meta_account_id TEXT NULL REFERENCES client_meta_accounts(id) ON DELETE RESTRICT;

ALTER TABLE meta_campaign_daily_metrics ALTER COLUMN client_id DROP NOT NULL;

UPDATE meta_campaign_daily_metrics AS metric
SET
  meta_ad_account_id = mapping.meta_ad_account_id,
  meta_account_id = mapping.id
FROM client_meta_accounts AS mapping
WHERE metric.meta_account_id IS NULL
  AND metric.client_id IS NOT NULL
  AND mapping.owner_scope = 'client'
  AND mapping.client_id = metric.client_id
  AND metric.date >= mapping.valid_from
  AND (mapping.valid_to IS NULL OR metric.date < mapping.valid_to);

ALTER TABLE meta_campaign_daily_metrics
  DROP CONSTRAINT IF EXISTS meta_campaign_daily_metrics_client_id_meta_campaign_id_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_metrics_canonical_identity_unique
  ON meta_campaign_daily_metrics (meta_ad_account_id, meta_campaign_id, date)
  WHERE meta_ad_account_id IS NOT NULL;

-- Historical rows that could not be attributed safely retain their original
-- client-scoped uniqueness until an operator resolves their account identity.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_metrics_legacy_identity_unique
  ON meta_campaign_daily_metrics (client_id, meta_campaign_id, date)
  WHERE meta_ad_account_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_meta_metrics_account_date
  ON meta_campaign_daily_metrics (meta_ad_account_id, date);

-- Defensive direct-access posture. Application authorization remains in the
-- server routes; zero policies means PostgREST anon/authenticated sees no rows.
ALTER TABLE client_meta_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_campaign_daily_metrics ENABLE ROW LEVEL SECURITY;

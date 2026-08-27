-- Results Manual Revenue V1 — moves the manual revenue ledger (previously
-- browser localStorage only, lib/results.ts's RevenueRecord) to Postgres.
--
-- This is a separate, secondary ledger — never merged into "Valor generado"
-- (SUM Lead.conversion_value over converted leads, lib/server/results-repo.ts)
-- and never fed into the real ROAS/CAC calculations (which are Meta-ad-spend
-- based). Field shapes are lifted directly from the current RevenueRecord
-- type; nothing here is a redesign.

CREATE TABLE IF NOT EXISTS revenue_records (
  id           TEXT PRIMARY KEY,

  -- Every manual revenue entry belongs to exactly one client — unlike leads,
  -- there is no "internal-scoped" revenue concept, so this is always required
  -- (no CHECK invariant needed the way leads.scope/client_id has one).
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,

  amount       NUMERIC NOT NULL CHECK (amount > 0),
  -- Date of the sale/payment itself, not the entry date (created_at below).
  occurred_at  TIMESTAMPTZ NOT NULL,

  -- Only 'manual' is ever produced by the API in V1 — 'stripe'/'paypal'/'crm'
  -- stay reserved for a future automated sync, matching
  -- REVENUE_SOURCE_OPTIONS in lib/results.ts.
  source       TEXT NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('manual', 'stripe', 'paypal', 'crm')),
  -- Dedup key for a future automated sync. Always NULL for manual entries.
  external_ref TEXT NULL,

  notes        TEXT NULL,

  -- 'demo' vs 'manual' — kept for type/UI continuity (RevenueDataSourceTag,
  -- DemoDataBadge). The API only ever writes 'manual'; no 'demo' row is ever
  -- seeded into this table by application code.
  data_source  TEXT NOT NULL DEFAULT 'manual' CHECK (data_source IN ('demo', 'manual')),

  -- Audit only, never caller-controlled — the API sets these from the
  -- authenticated internal user's id. ON DELETE SET NULL (not profiles'
  -- own CASCADE): a financial record must outlive the profile that entered
  -- it, so losing that user's account should null the attribution, not
  -- delete the record.
  created_by   UUID NULL REFERENCES profiles(user_id) ON DELETE SET NULL,
  updated_by   UUID NULL REFERENCES profiles(user_id) ON DELETE SET NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary access pattern: "this client's revenue records, filtered/sorted by
-- occurred_at" — mirrors idx_leads_client_id / idx_leads_last_activity_at.
CREATE INDEX IF NOT EXISTS idx_revenue_records_client_occurred
  ON revenue_records (client_id, occurred_at);

-- Prevents a future automated sync from double-inserting the same upstream
-- charge/transaction. Mirrors leads_external_identity_unique exactly (same
-- "source + id" composite reasoning: a bare Stripe charge id and a bare
-- PayPal transaction id must not collide as plain strings). Manual entries
-- (external_ref IS NULL) are never subject to this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS revenue_records_source_external_ref_unique
  ON revenue_records (source, external_ref)
  WHERE external_ref IS NOT NULL;

-- Defensive RLS — matches the posture every existing table in this schema
-- runs (RLS enabled, zero policies; see 0005_auth_foundation.sql). Not the
-- authorization mechanism (the server-side requireInternalUserOrResponse()/
-- requireClientAccessOrResponse() guards are) — only ensures direct
-- PostgREST/anon/authenticated access gets zero rows by default.
ALTER TABLE revenue_records ENABLE ROW LEVEL SECURITY;

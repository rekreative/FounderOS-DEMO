-- Connections/Secrets V1 — moves the canonical /connections manual
-- operational-record ledger (previously browser localStorage only,
-- lib/integration-connections.ts's IntegrationConnection, key
-- 'rek_integration_connections_v1') to Postgres. Field shapes are lifted
-- directly from the current IntegrationConnection type; nothing here is a
-- redesign, except archive/restore (status), which is new. Deliberately
-- unrelated to the legacy FounderOS connector marketplace
-- (lib/connectors/*, app/(internal)/integrations) — this table never
-- stores a secret value, only operational metadata about a connection a
-- human has manually recorded.
--
-- Not applied yet — created ahead of the controlled migration-application
-- step (see architecture audit / implementation report).

CREATE TABLE IF NOT EXISTS integration_connections (
  id                   TEXT PRIMARY KEY,

  -- REKREATIVE's own shared infrastructure (internal, client_id NULL) vs. a
  -- client's own connection (client, client_id required) — same invariant
  -- shape as leads.scope/client_id and knowledge_entries.scope/client_id.
  scope                TEXT NOT NULL CHECK (scope IN ('internal', 'client')),
  client_id            TEXT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT integration_connections_scope_client_id_invariant CHECK (
    (scope = 'internal' AND client_id IS NULL) OR
    (scope = 'client' AND client_id IS NOT NULL)
  ),

  -- The controlled taxonomy — matches lib/integration-connections.ts's
  -- INTEGRATION_PLATFORM_OPTIONS exactly.
  platform             TEXT NOT NULL CHECK (platform IN (
                          'meta', 'instagram', 'whatsapp', 'make', 'manychat',
                          'openai', 'anthropic', 'google_sheets',
                          'google_calendar', 'stripe', 'paypal', 'other'
                        )),

  name                 TEXT NOT NULL,

  -- Persisted manual claim, not a live check — see
  -- INTEGRATION_VERIFICATION_STATUS_OPTIONS/_METHOD_OPTIONS. 'system' stays
  -- reserved for a future real verifier; the repo never writes it in V1.
  verification_status  TEXT NOT NULL DEFAULT 'not_verified'
                          CHECK (verification_status IN ('not_verified', 'verified', 'failed')),
  verification_method  TEXT NULL CHECK (verification_method IN ('manual', 'system')),
  last_verified_at     TIMESTAMPTZ NULL,
  CONSTRAINT integration_connections_verification_invariant CHECK (
    (verification_status = 'not_verified' AND verification_method IS NULL AND last_verified_at IS NULL) OR
    (verification_status IN ('verified', 'failed') AND verification_method IS NOT NULL AND last_verified_at IS NOT NULL)
  ),

  -- Generic external reference/label — never a platform-specific field and
  -- never a secret. See lib/creds.ts / lib/connectors/* for where real
  -- credentials belong instead; this column must never hold one.
  external_ref         TEXT NULL,
  external_label       TEXT NULL,
  notes                TEXT NULL,

  -- 'demo' vs 'manual' — kept for type/UI continuity (DataSourceTag). The
  -- API only ever writes 'manual'; no 'demo' row is ever inserted by
  -- application code in Phase 1 (matches revenue_records/knowledge_entries
  -- convention — no production demo seed).
  data_source          TEXT NOT NULL DEFAULT 'manual' CHECK (data_source IN ('demo', 'manual')),

  -- Soft delete only — no hard DELETE in V1. New relative to the old
  -- localStorage model (which had no archive concept at all); mirrors
  -- knowledge_entries' active/archived split exactly.
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),

  -- Audit only, never caller-controlled — the API sets these from the
  -- authenticated internal user's id. ON DELETE SET NULL (not profiles' own
  -- CASCADE): an operational record must outlive the profile that entered
  -- it, so losing that user's account should null the attribution, not
  -- delete the record. Matches knowledge_entries/revenue_records exactly.
  created_by           UUID NULL REFERENCES profiles(user_id) ON DELETE SET NULL,
  updated_by           UUID NULL REFERENCES profiles(user_id) ON DELETE SET NULL,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary access patterns: "this client's connections" (client workspace
-- Integraciones tab) and "everything, newest-updated first" (the global
-- /connections board's default sort, both scope tabs). No platform/
-- verification_status/status index — those stay client-side filters over an
-- already-fetched, small, single-tenant-scale collection, same reasoning
-- knowledge_entries used to skip a tags GIN index.
CREATE INDEX IF NOT EXISTS idx_integration_connections_client_id ON integration_connections (client_id);
CREATE INDEX IF NOT EXISTS idx_integration_connections_updated_at ON integration_connections (updated_at DESC);

-- Defensive RLS — matches the posture every existing table in this schema
-- runs (RLS enabled, zero policies; see 0005_auth_foundation.sql). Not the
-- authorization mechanism (requireInternalUserOrResponse() is) — only
-- ensures direct PostgREST/anon/authenticated access gets zero rows by
-- default.
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;

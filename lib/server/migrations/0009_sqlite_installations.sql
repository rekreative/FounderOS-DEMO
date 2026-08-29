-- REKREOS Phase 2 external SQLite installation marker. Detects a
-- founder-os.db that was newly created, substituted, or restored from an
-- unrelated backup - something FOUNDER_OS_REQUIRE_EXISTING_DB=true
-- (Observability Phase 1, lib/data.ts) cannot see on its own, since a
-- substituted file still "exists" and opens fine. This table holds the
-- Postgres half of a stable installation UUID; the SQLite half lives inside
-- founder-os.db's own installation_metadata table
-- (lib/server/sqlite-installation.ts). Neither half is written by this
-- migration or by any ordinary application code path - only the explicit
-- `npm run register:installation` CLI
-- (lib/server/installation-registration.ts) ever writes a row here, once.
-- See docs/deployment.md's installation-marker section for the full
-- rollout sequence.
--
-- Deliberately its own table, not a column bolted onto an existing one:
-- this concept applies to exactly one store (founder-os.db) today and has
-- no natural home in clients/leads/knowledge_entries/etc.

CREATE TABLE IF NOT EXISTS sqlite_installations (
  -- Singleton row per known SQLite store. The CHECK constrains this
  -- PRIMARY KEY to a single known value today (founder-os.db is the only
  -- SQLite store this Phase 2 marker covers - bank.db/ledger.db stay out of
  -- scope, same split as lib/backup.ts and lib/server/sqlite-ready.ts),
  -- which is what actually makes the row deterministic: at most one
  -- 'founder-os' row can ever exist, and no other store_name can ever be
  -- inserted.
  store_name       TEXT PRIMARY KEY CHECK (store_name = 'founder-os'),

  -- The stable identity, generated once by the registration CLI and never
  -- reassigned afterward. UNIQUE is redundant with the singleton PK today
  -- but states the invariant directly and keeps this table correct if a
  -- second store name is ever added to the CHECK above later.
  installation_id  UUID NOT NULL UNIQUE,

  registered_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No seed, no automatic marker creation - this migration only creates the
-- table shape. Production starts with zero rows until a human runs
-- `npm run register:installation` once, by hand, per the deployment runbook.

-- Defensive RLS - matches the posture every existing table in this schema
-- runs (RLS enabled, zero policies; see 0005_auth_foundation.sql,
-- 0008_integration_connections.sql). Not the authorization mechanism (the
-- registration CLI and the startup verifier both connect as the trusted
-- postgres role via DATABASE_URL, never through PostgREST/anon/
-- authenticated) - only ensures direct PostgREST/anon/authenticated access
-- gets zero rows by default.
ALTER TABLE sqlite_installations ENABLE ROW LEVEL SECURITY;

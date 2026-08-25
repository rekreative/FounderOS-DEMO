-- Auth V1 application-authorization foundation. Identity itself is owned by
-- Supabase Auth (auth.users) — this migration adds only what REKREATIVE OS
-- needs on top of it: a role per user, and an explicit many-to-many grant
-- of which client(s) a client-role user may access. Additive only — no
-- existing table, column, or constraint is changed or dropped.

-- ── 1. profiles ────────────────────────────────────────────────────────────
-- One row per auth.users identity. user_id is both the PK and the FK — a
-- profile has no independent identity of its own. ON DELETE CASCADE
-- (deliberately different from every clients(id) FK's RESTRICT elsewhere in
-- this schema): a profile is meaningless once its auth user is gone, so
-- there is no orphaned-business-record risk to guard against here the way
-- there is for leads/client_meta_accounts.
CREATE TABLE IF NOT EXISTS profiles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('internal', 'client')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. user_client_access ─────────────────────────────────────────────────
-- Many-to-many grant: which client(s) a client-role user may see. References
-- profiles (not auth.users directly) so a grant can never exist for a user
-- with no role assigned yet. client_id is TEXT, matching clients.id's real
-- type (app-generated ids, not UUIDs).
--
-- client_id uses ON DELETE CASCADE, not the RESTRICT every other clients(id)
-- FK in this schema uses. Deliberate: lib/server/clients-repo.ts's
-- deleteClient() already blocks deletion of a client with existing leads
-- (leads.client_id's own RESTRICT) and specifically attributes any 23503 it
-- catches to that leads check, reporting a leadCount back to the caller. A
-- RESTRICT here would let a client with zero leads but an active access
-- grant also throw 23503 on delete, and deleteClient()'s existing handler
-- would misreport it as "blocked by leads" with leadCount: 0. CASCADE keeps
-- deleteClient()'s existing behavior exactly as designed — blocked by leads,
-- and only by leads — while access grants, which are meaningless once their
-- client is gone, simply go with it.
CREATE TABLE IF NOT EXISTS user_client_access (
  user_id    UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  client_id  TEXT NOT NULL REFERENCES clients(id)        ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);

-- Reverse lookup ("who has access to this client") — the composite PK above
-- already serves "does user X have access to client Y" and "list all
-- clients for user X" (both lead with user_id); this is the only additional
-- index needed.
CREATE INDEX IF NOT EXISTS idx_user_client_access_client_id
  ON user_client_access (client_id);

-- ── 3. Defensive RLS ──────────────────────────────────────────────────────
-- Matches the posture already in effect on every existing public table
-- (clients, leads, lead_events, client_meta_accounts, meta_sync_runs,
-- meta_campaign_daily_metrics, schema_migrations all run RLS-enabled with
-- zero policies today, though none of 0001-0004 declares it explicitly —
-- it's a project-level default this migration now states outright instead
-- of relying on). No policies: this is not the authorization mechanism
-- (REKREATIVE OS's own server-side requireUser()/requireClientAccess()
-- helpers are), it only ensures direct PostgREST/anon/authenticated access
-- gets zero rows by default. FORCE is deliberately not set, matching every
-- existing table — the server-side pg.Pool connection (as the postgres
-- role) must remain unaffected.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_client_access ENABLE ROW LEVEL SECURITY;

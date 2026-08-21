-- Backend V1 foundation: Clients, Leads, LeadEvents.
--
-- Field shapes and enum values are lifted directly from the current V1
-- localStorage models (lib/clients.ts's Client, lib/leads.ts's Lead /
-- LeadEvent) — nothing here is a redesign. client_notes is intentionally
-- NOT included in this pass (out of scope; stays localStorage-only).

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'prospect')),
  service TEXT NOT NULL,
  meta_budget_monthly NUMERIC NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  owner TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,

  -- REKREATIVE's own acquisition (internal, client_id NULL) vs. a client's
  -- own leads (client, client_id required) — REKREATIVE is never a Client
  -- row. Enforced structurally, not just in application code.
  scope TEXT NOT NULL CHECK (scope IN ('internal', 'client')),
  client_id TEXT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT leads_scope_client_id_invariant CHECK (
    (scope = 'internal' AND client_id IS NULL) OR
    (scope = 'client' AND client_id IS NOT NULL)
  ),

  name TEXT NOT NULL,
  email TEXT NULL,
  phone TEXT NULL,
  whatsapp TEXT NULL,

  -- Business/acquisition source ("Meta Ads", "Referral", "Manual", ...) —
  -- deliberately distinct from ingestion_source below (the technical path
  -- the row arrived through).
  lead_source TEXT NOT NULL DEFAULT 'Manual',
  campaign TEXT NULL,
  ad_creative TEXT NULL,
  form TEXT NULL,

  stage TEXT NOT NULL DEFAULT 'new' CHECK (
    stage IN ('new', 'contacted', 'qualified', 'appointment', 'converted', 'no_response', 'disqualified')
  ),

  ai_intent TEXT NULL CHECK (ai_intent IS NULL OR ai_intent IN ('cold', 'warm', 'hot')),
  ai_priority TEXT NULL CHECK (ai_priority IS NULL OR ai_priority IN ('low', 'medium', 'high')),
  ai_summary TEXT NULL,
  ai_qualification JSONB NULL,
  ai_analyzed_at TIMESTAMPTZ NULL,

  qualification_answers JSONB NULL,
  appointment_date TIMESTAMPTZ NULL,
  conversion_value NUMERIC NULL,

  -- Technical ingestion identity — never the application's primary key.
  -- See the two idempotency protections below.
  ingestion_source TEXT NULL,
  external_lead_id TEXT NULL,
  ingest_delivery_id TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency 1: a retried Make delivery (same execution) must never create
-- a second row. NULL allowed — manual/browser-created leads never carry a
-- delivery id, and NULL <> NULL in a unique constraint, so any number of
-- manual leads can coexist.
CREATE UNIQUE INDEX IF NOT EXISTS leads_ingest_delivery_id_unique
  ON leads (ingest_delivery_id)
  WHERE ingest_delivery_id IS NOT NULL;

-- Idempotency 2: the same upstream lead (e.g. the same Meta lead id)
-- arriving through a *different* Make execution must also resolve to one
-- row. Partial index — only applies once an external_lead_id exists at all.
CREATE UNIQUE INDEX IF NOT EXISTS leads_external_identity_unique
  ON leads (ingestion_source, external_lead_id)
  WHERE external_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_client_id ON leads (client_id);
CREATE INDEX IF NOT EXISTS idx_leads_scope ON leads (scope);
CREATE INDEX IF NOT EXISTS idx_leads_last_activity_at ON leads (last_activity_at);

-- Append-only lead timeline. No ON UPDATE/DELETE route exists for this
-- table by design (repository/API convention, not a DB trigger, in this
-- pass) — see lib/leads.ts's LeadEventType / LeadEventSource unions, which
-- these CHECK constraints mirror exactly.
CREATE TABLE IF NOT EXISTS lead_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,

  type TEXT NOT NULL CHECK (type IN (
    'lead_received',
    'ai_analyzed',
    'whatsapp_sent',
    'whatsapp_delivered',
    'lead_replied',
    'commercial_contacted',
    'appointment_booked',
    'appointment_completed',
    'converted',
    'disqualified',
    'manual_note',
    'stage_changed'
  )),

  source TEXT NOT NULL CHECK (source IN (
    'meta', 'openai', 'whatsapp', 'make', 'manual', 'crm', 'system'
  )),

  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary TEXT NOT NULL,
  details JSONB NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_events_lead_id ON lead_events (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_events_occurred_at ON lead_events (occurred_at);

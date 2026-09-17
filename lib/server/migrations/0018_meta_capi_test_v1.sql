-- Meta CAPI Test V1.
--
-- REKREOS records a durable delivery ledger before any automatic production
-- sending exists. It is server-only: no public policy is created and no
-- token, contact hash, request body, or Meta test code is persisted here.

CREATE TABLE IF NOT EXISTS lead_meta_capi_deliveries (
  id                  TEXT PRIMARY KEY,
  lead_id             TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_kind          TEXT NOT NULL CHECK (event_kind IN ('qualified_lead', 'appointment', 'converted')),
  meta_event_name     TEXT NOT NULL CHECK (meta_event_name IN ('Lead', 'Schedule', 'Purchase')),
  event_id            TEXT NOT NULL UNIQUE,
  delivery_mode       TEXT NOT NULL CHECK (delivery_mode IN ('test')),
  status              TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'failed')),
  attempt_count       INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempted_at   TIMESTAMPTZ NULL,
  accepted_at         TIMESTAMPTZ NULL,
  error_code          TEXT NULL,
  created_by          UUID NULL REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id, event_kind, delivery_mode)
);

CREATE INDEX IF NOT EXISTS idx_lead_meta_capi_deliveries_lead_created
  ON lead_meta_capi_deliveries (lead_id, created_at DESC);

ALTER TABLE lead_events DROP CONSTRAINT IF EXISTS lead_events_type_check;
ALTER TABLE lead_events ADD CONSTRAINT lead_events_type_check CHECK (type IN (
  'lead_received', 'ai_analyzed', 'whatsapp_sent', 'whatsapp_delivered',
  'whatsapp_failed', 'lead_replied', 'commercial_contacted', 'qualified',
  'appointment_booked', 'appointment_completed', 'proposal_sent', 'converted',
  'payment_received', 'meta_capi_test', 'disqualified', 'manual_note', 'stage_changed'
));

ALTER TABLE lead_meta_capi_deliveries ENABLE ROW LEVEL SECURITY;

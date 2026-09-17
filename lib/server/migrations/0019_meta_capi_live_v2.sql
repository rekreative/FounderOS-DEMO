-- Meta CAPI Live V2.
--
-- Extends the existing test-delivery ledger with an explicitly separate
-- production mode. Tokens, raw Graph responses, customer contact values,
-- contact hashes and Meta test codes are never persisted.

ALTER TABLE lead_meta_capi_deliveries
  DROP CONSTRAINT IF EXISTS lead_meta_capi_deliveries_delivery_mode_check;
ALTER TABLE lead_meta_capi_deliveries
  ADD CONSTRAINT lead_meta_capi_deliveries_delivery_mode_check
  CHECK (delivery_mode IN ('test', 'live'));

ALTER TABLE lead_meta_capi_deliveries
  ADD COLUMN IF NOT EXISTS event_occurred_at TIMESTAMPTZ NULL;

-- Qualified Lead and Schedule are one milestone per lead. Purchase instead
-- follows each actual receipt, which is essential for split-payment offers.
ALTER TABLE lead_meta_capi_deliveries
  ADD COLUMN IF NOT EXISTS source_identity TEXT NOT NULL DEFAULT 'lead';
ALTER TABLE lead_meta_capi_deliveries
  DROP CONSTRAINT IF EXISTS lead_meta_capi_deliveries_lead_id_event_kind_delivery_mode_key;
ALTER TABLE lead_meta_capi_deliveries
  ADD CONSTRAINT lead_meta_capi_deliveries_lead_kind_mode_source_identity_key
  UNIQUE (lead_id, event_kind, delivery_mode, source_identity);

ALTER TABLE lead_events DROP CONSTRAINT IF EXISTS lead_events_type_check;
ALTER TABLE lead_events ADD CONSTRAINT lead_events_type_check CHECK (type IN (
  'lead_received', 'ai_analyzed', 'whatsapp_sent', 'whatsapp_delivered',
  'whatsapp_failed', 'lead_replied', 'commercial_contacted', 'qualified',
  'appointment_booked', 'appointment_completed', 'proposal_sent', 'converted',
  'payment_received', 'meta_capi_test', 'meta_capi_live', 'disqualified',
  'manual_note', 'stage_changed'
));

ALTER TABLE lead_meta_capi_deliveries ENABLE ROW LEVEL SECURITY;

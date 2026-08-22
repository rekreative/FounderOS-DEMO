-- WhatsApp + Lead Lifecycle V1: durable idempotency for externally-reported
-- lead events (Make-reported WhatsApp sends/deliveries/replies), plus a
-- lookup path for resolving a lead by WhatsApp number. Additive only — no
-- existing column, constraint, or table is changed or dropped.

ALTER TABLE lead_events ADD COLUMN IF NOT EXISTS external_event_id TEXT NULL;

-- The same provider message id can legitimately produce more than one event
-- (e.g. whatsapp_sent then whatsapp_delivered for the same WhatsApp message
-- id) — idempotency must be keyed on (type, external_event_id), not the id
-- alone. NULL allowed: every event type that isn't externally reported
-- (stage_changed, manual_note, lead_received, ...) never carries one, and
-- NULL <> NULL means any number of those can coexist.
CREATE UNIQUE INDEX IF NOT EXISTS lead_events_type_external_id_unique
  ON lead_events (type, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- Supports resolving a lead by WhatsApp number for inbound Make-reported
-- events (whatsapp_delivered / lead_replied only carry the phone number,
-- not the lead id) without storing a second normalized column on leads —
-- the expression mirrors lib/phone.ts's normalizePhoneDigits exactly enough
-- for indexing purposes (digit-only comparison).
CREATE INDEX IF NOT EXISTS idx_leads_whatsapp_digits
  ON leads (regexp_replace(whatsapp, '\D', '', 'g'))
  WHERE whatsapp IS NOT NULL;

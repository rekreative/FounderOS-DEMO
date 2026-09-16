-- Commercial Financial Truth V1.
--
-- `leads.conversion_value` remains the commercial agreement. This ledger is
-- the separate source of truth for real money collected, allowing a second
-- instalment, recurring monthly receipts and future Stripe webhooks without
-- overwriting the original deal.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS conversion_collected_total NUMERIC NOT NULL DEFAULT 0
    CHECK (conversion_collected_total >= 0);

CREATE TABLE IF NOT EXISTS lead_payments (
  id                  TEXT PRIMARY KEY,
  lead_id             TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  amount              NUMERIC NOT NULL CHECK (amount > 0),
  occurred_at         TIMESTAMPTZ NOT NULL,
  source              TEXT NOT NULL CHECK (source IN ('manual', 'conversion_initial', 'stripe', 'paypal')),
  external_event_id   TEXT NULL,
  notes               TEXT NULL,
  created_by          UUID NULL REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_payments_lead_occurred
  ON lead_payments (lead_id, occurred_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS lead_payments_source_external_event_unique
  ON lead_payments (source, external_event_id)
  WHERE external_event_id IS NOT NULL;

-- The V1 conversion form already captured an initial payment. Materialize it
-- once as an auditable receipt before using the ledger for new payments.
INSERT INTO lead_payments (id, lead_id, amount, occurred_at, source, external_event_id, notes)
SELECT
  'payment-backfill-' || l.id,
  l.id,
  l.conversion_initial_payment,
  COALESCE(l.conversion_recorded_at, l.last_activity_at, l.created_at),
  'conversion_initial',
  'legacy-conversion-initial:' || l.id,
  'Cobro inicial migrado desde la conversión'
FROM leads l
WHERE l.conversion_initial_payment IS NOT NULL
  AND l.conversion_initial_payment > 0
  AND NOT EXISTS (
    SELECT 1 FROM lead_payments p
    WHERE p.source = 'conversion_initial'
      AND p.external_event_id = 'legacy-conversion-initial:' || l.id
  );

UPDATE leads l
SET conversion_collected_total = COALESCE((
  SELECT SUM(p.amount) FROM lead_payments p WHERE p.lead_id = l.id
), 0);

ALTER TABLE lead_events DROP CONSTRAINT IF EXISTS lead_events_type_check;
ALTER TABLE lead_events ADD CONSTRAINT lead_events_type_check CHECK (type IN (
  'lead_received', 'ai_analyzed', 'whatsapp_sent', 'whatsapp_delivered',
  'whatsapp_failed', 'lead_replied', 'commercial_contacted', 'qualified',
  'appointment_booked', 'appointment_completed', 'proposal_sent', 'converted',
  'payment_received', 'disqualified', 'manual_note', 'stage_changed'
));

ALTER TABLE lead_payments ENABLE ROW LEVEL SECURITY;

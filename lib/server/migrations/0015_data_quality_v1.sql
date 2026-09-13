-- REKREOS Data Quality V1.
-- Adds the provider page identity used by tenant-aware Meta lead routing and
-- records explicit WhatsApp send failures as technical timeline events.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS meta_page_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_meta_page_form
  ON leads (meta_page_id, meta_form_id)
  WHERE meta_form_id IS NOT NULL;

ALTER TABLE lead_events
  DROP CONSTRAINT IF EXISTS lead_events_type_check;

ALTER TABLE lead_events
  ADD CONSTRAINT lead_events_type_check CHECK (type IN (
    'lead_received',
    'ai_analyzed',
    'whatsapp_sent',
    'whatsapp_delivered',
    'whatsapp_failed',
    'lead_replied',
    'commercial_contacted',
    'qualified',
    'appointment_booked',
    'appointment_completed',
    'converted',
    'disqualified',
    'manual_note',
    'stage_changed'
  ));


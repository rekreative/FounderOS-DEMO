-- Qualification V1: make commercial qualification an explicit, durable
-- lead-event fact while keeping Lead.stage as the only lifecycle state.

ALTER TABLE lead_events
  DROP CONSTRAINT IF EXISTS lead_events_type_check;

ALTER TABLE lead_events
  ADD CONSTRAINT lead_events_type_check CHECK (type IN (
    'lead_received',
    'ai_analyzed',
    'whatsapp_sent',
    'whatsapp_delivered',
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

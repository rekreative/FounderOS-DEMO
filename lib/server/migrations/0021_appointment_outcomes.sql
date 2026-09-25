-- Additive appointment outcomes. No stage, money, permission or existing
-- event is rewritten. Uses the application's existing migration runner.
-- 0020_appointment_status_events_v1.sql already exists in production's
-- migration ledger; this distinct migration preserves its allowed types.
ALTER TABLE lead_events DROP CONSTRAINT IF EXISTS lead_events_type_check;
ALTER TABLE lead_events ADD CONSTRAINT lead_events_type_check CHECK (type IN (
  'lead_received', 'ai_analyzed', 'whatsapp_sent', 'whatsapp_delivered',
  'whatsapp_failed', 'lead_replied', 'commercial_contacted', 'qualified',
  'appointment_booked', 'appointment_completed', 'appointment_confirmed',
  'appointment_cancelled', 'appointment_no_show', 'proposal_sent', 'converted',
  'payment_received', 'meta_capi_test', 'meta_capi_live', 'disqualified',
  'manual_note', 'stage_changed'
));

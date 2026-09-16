-- Additive lifecycle change; no historical proposals are inferred/backfilled.
-- Deploy this migration before the application accepts proposal_sent.
ALTER TABLE leads DROP CONSTRAINT leads_stage_check;
ALTER TABLE leads ADD CONSTRAINT leads_stage_check CHECK (stage IN (
  'new', 'contacted', 'qualified', 'appointment', 'proposal_sent',
  'converted', 'no_response', 'disqualified'
));

ALTER TABLE lead_events DROP CONSTRAINT lead_events_type_check;
ALTER TABLE lead_events ADD CONSTRAINT lead_events_type_check CHECK (type IN (
  'lead_received', 'ai_analyzed', 'whatsapp_sent', 'whatsapp_delivered',
  'whatsapp_failed', 'lead_replied', 'commercial_contacted', 'qualified',
  'appointment_booked', 'appointment_completed', 'proposal_sent', 'converted',
  'disqualified', 'manual_note', 'stage_changed'
));

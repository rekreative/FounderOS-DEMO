-- Results Real + Home Real V1: leads.created_at becomes a first-class query
-- filter — Results' acquisition-cohort queries range-filter on it, and
-- Home's "leads today"/"recent leads" widgets sort/filter by it too. Only
-- last_activity_at was indexed before this pass. Additive only.

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at);

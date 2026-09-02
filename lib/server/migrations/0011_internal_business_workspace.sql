-- REKREATIVE Workspace V1. Canonical, internal-only business configuration.
-- No business data is seeded by this migration: the operator creates it
-- explicitly after deployment through the authenticated internal API.

CREATE TABLE IF NOT EXISTS internal_business_profile (
  workspace_key TEXT PRIMARY KEY CHECK (workspace_key = 'rekreative'),
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  monthly_revenue_target NUMERIC NOT NULL CHECK (monthly_revenue_target >= 0),
  monthly_new_clients_min INTEGER NOT NULL CHECK (monthly_new_clients_min >= 0),
  monthly_new_clients_target INTEGER NOT NULL CHECK (monthly_new_clients_target >= monthly_new_clients_min),
  monthly_new_clients_max INTEGER NOT NULL CHECK (monthly_new_clients_max >= monthly_new_clients_target),
  monthly_leads_min INTEGER NOT NULL CHECK (monthly_leads_min >= 0),
  monthly_leads_target INTEGER NOT NULL CHECK (monthly_leads_target >= monthly_leads_min),
  monthly_leads_max INTEGER NOT NULL CHECK (monthly_leads_max >= monthly_leads_target),
  monthly_appointments_target INTEGER NOT NULL CHECK (monthly_appointments_target >= 0),
  acquisition_channels JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(acquisition_channels) = 'array'),
  tools JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tools) = 'array'),
  commercial_policy TEXT NOT NULL,
  created_by UUID NULL REFERENCES profiles(user_id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS internal_business_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NULL,
  price NUMERIC NOT NULL CHECK (price >= 0),
  billing_type TEXT NOT NULL CHECK (billing_type IN ('one_off', 'monthly')),
  allow_two_payments BOOLEAN NOT NULL DEFAULT false,
  second_payment_trigger TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT internal_business_services_payment_check CHECK (
    (allow_two_payments = true AND billing_type = 'one_off' AND second_payment_trigger IS NOT NULL) OR
    (allow_two_payments = false AND second_payment_trigger IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_internal_business_services_order
  ON internal_business_services (active DESC, sort_order, name);

ALTER TABLE internal_business_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_business_services ENABLE ROW LEVEL SECURITY;

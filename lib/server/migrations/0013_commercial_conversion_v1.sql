-- Commercial Conversion V1. The current service catalog remains editable,
-- while every converted lead keeps the exact commercial agreement accepted
-- at conversion time. Existing conversions remain valid with NULL snapshots.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS conversion_service_id TEXT NULL
    REFERENCES internal_business_services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversion_service_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS conversion_service_billing_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS conversion_service_standard_price NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS conversion_payment_plan TEXT NULL,
  ADD COLUMN IF NOT EXISTS conversion_initial_payment NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS conversion_second_payment_trigger TEXT NULL,
  ADD COLUMN IF NOT EXISTS conversion_recorded_at TIMESTAMPTZ NULL;

ALTER TABLE leads
  ADD CONSTRAINT leads_conversion_billing_type_check
    CHECK (conversion_service_billing_type IS NULL OR conversion_service_billing_type IN ('one_off', 'monthly')),
  ADD CONSTRAINT leads_conversion_payment_plan_check
    CHECK (conversion_payment_plan IS NULL OR conversion_payment_plan IN ('full', 'two_payments', 'monthly', 'custom')),
  ADD CONSTRAINT leads_conversion_standard_price_check
    CHECK (conversion_service_standard_price IS NULL OR conversion_service_standard_price >= 0),
  ADD CONSTRAINT leads_conversion_initial_payment_check
    CHECK (conversion_initial_payment IS NULL OR conversion_initial_payment >= 0),
  ADD CONSTRAINT leads_conversion_initial_not_above_value_check
    CHECK (conversion_initial_payment IS NULL OR conversion_value IS NULL OR conversion_initial_payment <= conversion_value),
  ADD CONSTRAINT leads_conversion_snapshot_check CHECK (
    (conversion_service_id IS NULL
      AND conversion_service_name IS NULL
      AND conversion_service_billing_type IS NULL
      AND conversion_service_standard_price IS NULL
      AND conversion_payment_plan IS NULL
      AND conversion_initial_payment IS NULL
      AND conversion_second_payment_trigger IS NULL
      AND conversion_recorded_at IS NULL)
    OR
    (conversion_service_name IS NOT NULL
      AND conversion_service_billing_type IS NOT NULL
      AND conversion_service_standard_price IS NOT NULL
      AND conversion_payment_plan IS NOT NULL
      AND conversion_initial_payment IS NOT NULL
      AND conversion_recorded_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_leads_conversion_service_id
  ON leads (conversion_service_id)
  WHERE conversion_service_id IS NOT NULL;

-- WhatsApp tenant-aware inbound routing.
-- Phone Number ID is the canonical destination identity. Ownership is
-- effective-dated so delayed webhook retries resolve against the owner that
-- held the number when the message occurred.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS whatsapp_business_numbers (
  id                   TEXT PRIMARY KEY,
  owner_scope          TEXT NOT NULL CHECK (owner_scope IN ('internal', 'client')),
  client_id            TEXT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT whatsapp_business_numbers_owner_invariant CHECK (
    (owner_scope = 'internal' AND client_id IS NULL) OR
    (owner_scope = 'client' AND client_id IS NOT NULL)
  ),
  phone_number_id      TEXT NOT NULL CHECK (phone_number_id ~ '^[0-9]+$'),
  waba_id              TEXT NULL CHECK (waba_id IS NULL OR waba_id ~ '^[0-9]+$'),
  display_phone_number TEXT NULL,
  label                TEXT NULL,
  valid_from           TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to             TIMESTAMPTZ NULL,
  CONSTRAINT whatsapp_business_numbers_valid_range CHECK (
    valid_to IS NULL OR valid_to >= valid_from
  ),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_business_numbers_owner_identity_unique
  ON whatsapp_business_numbers (
    owner_scope,
    COALESCE(client_id, ''),
    phone_number_id,
    valid_from
  );

ALTER TABLE whatsapp_business_numbers
  ADD CONSTRAINT whatsapp_business_numbers_no_overlapping_ownership
  EXCLUDE USING gist (
    phone_number_id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
  );

CREATE INDEX IF NOT EXISTS idx_whatsapp_business_numbers_owner
  ON whatsapp_business_numbers (owner_scope, client_id, valid_from DESC);

-- Preserve the raw number for display and add one canonical matching value.
-- Existing values are normalized exactly like normalizePhoneDigits(): strip
-- non-digits, then strip one leading international 00 prefix.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_normalized TEXT NULL;

CREATE OR REPLACE FUNCTION rek_normalize_whatsapp_digits(raw TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    regexp_replace(regexp_replace(COALESCE(raw, ''), '\D', '', 'g'), '^00', ''),
    ''
  );
$$;

UPDATE leads
SET whatsapp_normalized = rek_normalize_whatsapp_digits(whatsapp)
WHERE whatsapp_normalized IS NULL;

CREATE OR REPLACE FUNCTION set_leads_whatsapp_normalized()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.whatsapp_normalized := rek_normalize_whatsapp_digits(NEW.whatsapp);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_whatsapp_normalized_sync ON leads;
CREATE TRIGGER leads_whatsapp_normalized_sync
BEFORE INSERT OR UPDATE OF whatsapp ON leads
FOR EACH ROW EXECUTE FUNCTION set_leads_whatsapp_normalized();

CREATE INDEX IF NOT EXISTS idx_leads_internal_whatsapp_normalized
  ON leads (whatsapp_normalized)
  WHERE scope = 'internal' AND client_id IS NULL AND whatsapp_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_client_whatsapp_normalized
  ON leads (client_id, whatsapp_normalized)
  WHERE scope = 'client' AND whatsapp_normalized IS NOT NULL;

-- The nullable FK records the exact ownership mapping used for an inbound
-- WhatsApp event. Existing and non-WhatsApp events remain unchanged.
ALTER TABLE lead_events
  ADD COLUMN IF NOT EXISTS whatsapp_business_number_id TEXT NULL
    REFERENCES whatsapp_business_numbers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_lead_events_whatsapp_business_number_id
  ON lead_events (whatsapp_business_number_id)
  WHERE whatsapp_business_number_id IS NOT NULL;

ALTER TABLE whatsapp_business_numbers ENABLE ROW LEVEL SECURITY;

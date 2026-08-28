-- G-Brain Postgres V1 — moves REKREATIVE's structured institutional
-- knowledge (previously browser localStorage only, lib/knowledge-entries.ts's
-- KnowledgeEntry, key 'rek_knowledge_entries_v1') to Postgres. Field shapes
-- are lifted directly from the current KnowledgeEntry type; nothing here is
-- a redesign. Deliberately separate from the unrelated legacy FounderOS
-- G-Brain (lib/brain*.ts, lib/connectors/gbrain.ts, /brain/legacy) — that
-- system is untouched by this migration.
--
-- No demo rows are seeded here on purpose — production starts with an empty
-- knowledge_entries table. See scripts/seed-backend-v1.ts's own doc comment
-- for the repo's dev-seed convention if one is ever added for this table.

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id            TEXT PRIMARY KEY,

  -- REKREATIVE's own institutional knowledge (internal, client_id NULL) vs.
  -- a client's own knowledge (client, client_id required) — same invariant
  -- shape as leads.scope/client_id in 0001_init.sql.
  scope         TEXT NOT NULL CHECK (scope IN ('internal', 'client')),
  client_id     TEXT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT knowledge_entries_scope_client_id_invariant CHECK (
    (scope = 'internal' AND client_id IS NULL) OR
    (scope = 'client' AND client_id IS NOT NULL)
  ),

  title         TEXT NOT NULL,

  -- The controlled taxonomy — KNOWLEDGE_TYPE_OPTIONS in lib/knowledge-entries.ts.
  type          TEXT NOT NULL CHECK (type IN (
                  'decision', 'learning', 'sop', 'strategy',
                  'client_context', 'technical_note', 'other'
                )),

  -- Free tags — flexible context, never a second controlled taxonomy.
  tags          TEXT[] NOT NULL DEFAULT '{}',

  summary       TEXT NOT NULL DEFAULT '',
  content       TEXT NOT NULL DEFAULT '',

  -- Provenance only — KNOWLEDGE_SOURCE_OPTIONS in lib/knowledge-entries.ts.
  source        TEXT NOT NULL CHECK (source IN (
                  'manual', 'client', 'campaign', 'meeting',
                  'analysis', 'document', 'system', 'other'
                )),
  source_label  TEXT NULL,

  -- Only two states — G-Brain is memory, not a task workflow. No draft/review.
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),

  -- 'demo' vs 'manual' — kept for type/UI continuity (the "Mostrar demo"
  -- toggle). The API only ever writes 'manual'; no 'demo' row is ever
  -- inserted by application code in Phase 1.
  data_source   TEXT NOT NULL DEFAULT 'manual' CHECK (data_source IN ('demo', 'manual')),

  -- Audit only, never caller-controlled — the API sets these from the
  -- authenticated internal user's id. ON DELETE SET NULL (not profiles'
  -- own CASCADE): institutional knowledge must outlive the profile that
  -- entered it, so losing that user's account should null the
  -- attribution, not delete the record.
  created_by    UUID NULL REFERENCES profiles(user_id) ON DELETE SET NULL,
  updated_by    UUID NULL REFERENCES profiles(user_id) ON DELETE SET NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary access patterns: "this client's knowledge" and "everything,
-- newest first" (the global /brain board's default sort). No tags GIN
-- index yet — Phase 1 tag/search filtering stays entirely client-side over
-- the fetched collection, so a GIN index would be speculative.
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_client_id ON knowledge_entries (client_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_updated_at ON knowledge_entries (updated_at DESC);

-- Defensive RLS — matches the posture every existing table in this schema
-- runs (RLS enabled, zero policies; see 0005_auth_foundation.sql). Not the
-- authorization mechanism (requireInternalUserOrResponse() is) — only
-- ensures direct PostgREST/anon/authenticated access gets zero rows by
-- default.
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;

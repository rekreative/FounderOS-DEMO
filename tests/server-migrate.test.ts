import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { applyMigrations, listMigrationFiles, MIGRATIONS_DIR } from '@/lib/server/migrate';
import { resolveTestDatabaseUrl } from './helpers/pg-test-env';

describe('migration file discovery', () => {
  it('finds every migration file and returns them in deterministic filename order', () => {
    const files = listMigrationFiles();
    expect(files).toEqual([
      '0001_init.sql',
      '0002_lead_events_whatsapp.sql',
      '0003_leads_created_at_index.sql',
      '0004_meta_ads_real_v1.sql',
      '0005_auth_foundation.sql',
      '0006_revenue_records.sql',
      '0007_knowledge_entries.sql',
      '0008_integration_connections.sql',
    ]);
  });
});

describe('0001_init.sql contains the critical Backend V1 invariants', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8');

  it('creates all three domain tables', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS clients/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS leads/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS lead_events/);
  });

  it('does NOT create a client_notes table in this pass', () => {
    expect(sql).not.toMatch(/CREATE TABLE[^;]*client_notes/is);
  });

  it('enforces the client status set', () => {
    expect(sql).toMatch(/status IN \('active', 'paused', 'prospect'\)/);
  });

  it('enforces the scope invariant: internal → client_id NULL, client → client_id required', () => {
    expect(sql).toMatch(/scope = 'internal' AND client_id IS NULL/);
    expect(sql).toMatch(/scope = 'client' AND client_id IS NOT NULL/);
  });

  it('references clients with ON DELETE RESTRICT, never CASCADE', () => {
    expect(sql).toMatch(/client_id TEXT NULL REFERENCES clients\(id\) ON DELETE RESTRICT/);
    expect(sql).toMatch(/lead_id TEXT NOT NULL REFERENCES leads\(id\) ON DELETE RESTRICT/);
    expect(sql).not.toMatch(/ON DELETE CASCADE/);
  });

  it('preserves the exact current CRM stage set', () => {
    expect(sql).toMatch(
      /stage IN \('new', 'contacted', 'qualified', 'appointment', 'converted', 'no_response', 'disqualified'\)/,
    );
  });

  it('constrains ai_intent/ai_priority to the current values, nullable', () => {
    expect(sql).toMatch(/ai_intent IS NULL OR ai_intent IN \('cold', 'warm', 'hot'\)/);
    expect(sql).toMatch(/ai_priority IS NULL OR ai_priority IN \('low', 'medium', 'high'\)/);
  });

  it('preserves the exact current LeadEventType and LeadEventSource unions from lib/leads.ts', () => {
    const eventTypes = [
      'lead_received',
      'ai_analyzed',
      'whatsapp_sent',
      'whatsapp_delivered',
      'lead_replied',
      'commercial_contacted',
      'appointment_booked',
      'appointment_completed',
      'converted',
      'disqualified',
      'manual_note',
      'stage_changed',
    ];
    for (const type of eventTypes) expect(sql).toContain(`'${type}'`);

    const eventSources = ['meta', 'openai', 'whatsapp', 'make', 'manual', 'crm', 'system'];
    for (const source of eventSources) expect(sql).toContain(`'${source}'`);
  });

  it('has both idempotency protections: delivery id and external identity, both partial (NULL allowed)', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS leads_ingest_delivery_id_unique\s+ON leads \(ingest_delivery_id\)\s+WHERE ingest_delivery_id IS NOT NULL/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS leads_external_identity_unique\s+ON leads \(ingestion_source, external_lead_id\)\s+WHERE external_lead_id IS NOT NULL/,
    );
  });

  it('keeps lead_source (business) and ingestion_source (technical) as distinct columns', () => {
    expect(sql).toMatch(/lead_source TEXT NOT NULL DEFAULT 'Manual'/);
    expect(sql).toMatch(/ingestion_source TEXT NULL/);
    expect(sql).toMatch(/external_lead_id TEXT NULL/);
    expect(sql).toMatch(/ingest_delivery_id TEXT NULL/);
  });
});

describe('0002_lead_events_whatsapp.sql contains the WhatsApp + Lead Lifecycle V1 additions', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0002_lead_events_whatsapp.sql'), 'utf8');

  it('adds external_event_id to lead_events, additively', () => {
    expect(sql).toMatch(/ALTER TABLE lead_events ADD COLUMN IF NOT EXISTS external_event_id TEXT NULL/);
  });

  it('enforces idempotency on (type, external_event_id), not external_event_id alone', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS lead_events_type_external_id_unique\s+ON lead_events \(type, external_event_id\)\s+WHERE external_event_id IS NOT NULL/,
    );
  });

  it('adds a digits-only lookup index on leads.whatsapp', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_leads_whatsapp_digits\s+ON leads \(regexp_replace\(whatsapp, '\\D', '', 'g'\)\)\s+WHERE whatsapp IS NOT NULL/,
    );
  });
});

describe('0003_leads_created_at_index.sql contains the Results Real + Home Real V1 addition', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0003_leads_created_at_index.sql'), 'utf8');

  it('adds an index on leads.created_at, additively', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads \(created_at\)/);
  });
});

describe('0004_meta_ads_real_v1.sql contains the Meta Ads Real V1 additions', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0004_meta_ads_real_v1.sql'), 'utf8');

  it('creates the three Meta Ads tables in FK-safe order', () => {
    const accountsIdx = sql.indexOf('CREATE TABLE IF NOT EXISTS client_meta_accounts');
    const syncRunsIdx = sql.indexOf('CREATE TABLE IF NOT EXISTS meta_sync_runs');
    const metricsIdx = sql.indexOf('CREATE TABLE IF NOT EXISTS meta_campaign_daily_metrics');
    expect(accountsIdx).toBeGreaterThan(-1);
    expect(syncRunsIdx).toBeGreaterThan(accountsIdx);
    expect(metricsIdx).toBeGreaterThan(syncRunsIdx);
  });

  it('references clients with ON DELETE RESTRICT, never CASCADE', () => {
    expect(sql).toMatch(/client_id TEXT NOT NULL REFERENCES clients\(id\) ON DELETE RESTRICT/);
    expect(sql).not.toMatch(/ON DELETE CASCADE/);
  });

  it('enforces the idempotent UPSERT key on meta_campaign_daily_metrics', () => {
    expect(sql).toMatch(/UNIQUE \(client_id, meta_campaign_id, date\)/);
  });

  it('enforces at most one ACTIVE mapping per Meta ad account id', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_client_meta_accounts_active_account_unique\s+ON client_meta_accounts \(meta_ad_account_id\)\s+WHERE active = true/,
    );
  });

  it('constrains meta_sync_runs.status to success/partial/error', () => {
    expect(sql).toMatch(/status TEXT NOT NULL CHECK \(status IN \('success', 'partial', 'error'\)\)/);
  });

  it('adds the four Meta attribution columns to leads, additively and nullable', () => {
    expect(sql).toMatch(/ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_campaign_id TEXT NULL/);
    expect(sql).toMatch(/ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_adset_id TEXT NULL/);
    expect(sql).toMatch(/ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_ad_id TEXT NULL/);
    expect(sql).toMatch(/ALTER TABLE leads ADD COLUMN IF NOT EXISTS meta_form_id TEXT NULL/);
  });

  it('does NOT create adset/ad/creative-level tables in V1', () => {
    expect(sql).not.toMatch(/CREATE TABLE[^;]*meta_adset/is);
    expect(sql).not.toMatch(/CREATE TABLE[^;]*meta_ad_daily/is);
    expect(sql).not.toMatch(/CREATE TABLE[^;]*creative/is);
  });
});

describe('0007_knowledge_entries.sql contains the G-Brain Postgres V1 additions', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0007_knowledge_entries.sql'), 'utf8');

  it('creates the knowledge_entries table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS knowledge_entries/);
  });

  it('references clients with ON DELETE RESTRICT, never CASCADE', () => {
    expect(sql).toMatch(/client_id\s+TEXT NULL REFERENCES clients\(id\) ON DELETE RESTRICT/);
    expect(sql).not.toMatch(/ON DELETE CASCADE/);
  });

  it('enforces the scope invariant: internal → client_id NULL, client → client_id required', () => {
    expect(sql).toMatch(/scope = 'internal' AND client_id IS NULL/);
    expect(sql).toMatch(/scope = 'client' AND client_id IS NOT NULL/);
  });

  it('preserves the exact current KnowledgeType/KnowledgeSource enums from lib/knowledge-entries.ts', () => {
    const types = ['decision', 'learning', 'sop', 'strategy', 'client_context', 'technical_note', 'other'];
    for (const type of types) expect(sql).toContain(`'${type}'`);

    const sources = ['manual', 'client', 'campaign', 'meeting', 'analysis', 'document', 'system', 'other'];
    for (const source of sources) expect(sql).toContain(`'${source}'`);
  });

  it('constrains status to active/archived — no workflow states', () => {
    expect(sql).toMatch(/status IN \('active', 'archived'\)/);
  });

  it('constrains data_source to demo/manual, defaulting to manual', () => {
    expect(sql).toMatch(/data_source\s+TEXT NOT NULL DEFAULT 'manual' CHECK \(data_source IN \('demo', 'manual'\)\)/);
  });

  it('tags is a plain TEXT[] with no GIN index in this pass — Phase 1 tag/search filtering stays client-side', () => {
    expect(sql).toMatch(/tags\s+TEXT\[\] NOT NULL DEFAULT '\{\}'/);
    expect(sql).not.toMatch(/USING GIN/);
  });

  it('does NOT seed any demo rows — production starts empty', () => {
    expect(sql).not.toMatch(/INSERT INTO knowledge_entries/i);
  });

  it('enables RLS with no policies — defensive posture only', () => {
    expect(sql).toMatch(/ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});

// Real-database integration coverage. Skips cleanly — never with a confusing
// failure — when no DATABASE_URL is configured. Applying migrations here is
// safe to run repeatedly: schema_migrations tracks what already ran, and
// every DDL statement in 0001_init.sql is idempotent (IF NOT EXISTS).
const TEST_DATABASE_URL = resolveTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('migrations applied against a real PostgreSQL (DATABASE_URL configured)', () => {
  it('applies 0001_init.sql and leaves the expected tables, constraints, and indexes in place', async () => {
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await applyMigrations(client);

      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      const tableNames = tables.rows.map((r) => r.table_name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          'clients',
          'leads',
          'lead_events',
          'schema_migrations',
          'client_meta_accounts',
          'meta_sync_runs',
          'meta_campaign_daily_metrics',
        ]),
      );

      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'leads'`,
      );
      const indexNames = indexes.rows.map((r) => r.indexname);
      expect(indexNames).toEqual(
        expect.arrayContaining(['leads_ingest_delivery_id_unique', 'leads_external_identity_unique']),
      );

      const leadColumns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads'`,
      );
      const leadColumnNames = leadColumns.rows.map((r) => r.column_name);
      expect(leadColumnNames).toEqual(
        expect.arrayContaining(['meta_campaign_id', 'meta_adset_id', 'meta_ad_id', 'meta_form_id']),
      );

      const applied = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
      expect(applied.rows.map((r) => r.id)).toContain('0001_init.sql');
      expect(applied.rows.map((r) => r.id)).toContain('0004_meta_ads_real_v1.sql');
    } finally {
      await client.end();
    }
  });

  it('is safe to apply twice — the second run applies nothing new', async () => {
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      await applyMigrations(client);
      const ranSecondTime = await applyMigrations(client);
      expect(ranSecondTime).toEqual([]);
    } finally {
      await client.end();
    }
  });
});

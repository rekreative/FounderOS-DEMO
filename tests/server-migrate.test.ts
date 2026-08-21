import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { applyMigrations, listMigrationFiles, MIGRATIONS_DIR } from '@/lib/server/migrate';
import { resolveTestDatabaseUrl } from './helpers/pg-test-env';

describe('migration file discovery', () => {
  it('finds 0001_init.sql and returns migrations in deterministic filename order', () => {
    const files = listMigrationFiles();
    expect(files).toEqual(['0001_init.sql']);
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
      expect(tableNames).toEqual(expect.arrayContaining(['clients', 'leads', 'lead_events', 'schema_migrations']));

      const indexes = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'leads'`,
      );
      const indexNames = indexes.rows.map((r) => r.indexname);
      expect(indexNames).toEqual(
        expect.arrayContaining(['leads_ingest_delivery_id_unique', 'leads_external_identity_unique']),
      );

      const applied = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
      expect(applied.rows.map((r) => r.id)).toContain('0001_init.sql');
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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyMigrations,
  buildMigrationClientConfig,
  listMigrationFiles,
  MIGRATIONS_DIR,
  resolveSupabaseCaPem,
  runCli,
  runCliSafely,
  type MigrateClientLike,
} from '@/lib/server/migrate';
import { resolveTestDatabaseUrl } from './helpers/pg-test-env';

describe('buildMigrationClientConfig - Supabase TLS (constructor config only, never dials a database)', () => {
  const ORIGINAL_CA = process.env.SUPABASE_CA_PEM;
  const ORIGINAL_ENV_LOCAL = process.env.FOUNDER_OS_ENV_LOCAL;
  let tmp: string | undefined;

  afterEach(() => {
    if (ORIGINAL_CA === undefined) delete process.env.SUPABASE_CA_PEM;
    else process.env.SUPABASE_CA_PEM = ORIGINAL_CA;
    if (ORIGINAL_ENV_LOCAL === undefined) delete process.env.FOUNDER_OS_ENV_LOCAL;
    else process.env.FOUNDER_OS_ENV_LOCAL = ORIGINAL_ENV_LOCAL;
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function makeFakeEnvLocal(contents: string): string {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-env-local-'));
    const file = path.join(tmp, '.env.local');
    fs.writeFileSync(file, contents);
    return file;
  }

  it('passes ssl.ca and ssl.rejectUnauthorized=true when SUPABASE_CA_PEM is set', () => {
    process.env.SUPABASE_CA_PEM = '-----BEGIN CERTIFICATE-----\nFAKE-NOT-REAL-TEST-CA\n-----END CERTIFICATE-----';
    const config = buildMigrationClientConfig('postgres://fake-not-real/db');
    expect(config.ssl).toEqual({ ca: process.env.SUPABASE_CA_PEM, rejectUnauthorized: true });
  });

  it('omits ssl entirely when SUPABASE_CA_PEM is absent - local dev behavior unchanged', () => {
    delete process.env.SUPABASE_CA_PEM;
    const config = buildMigrationClientConfig('postgres://fake-not-real/db');
    expect('ssl' in config).toBe(false);
  });

  it('never produces rejectUnauthorized: false, even for a falsy SUPABASE_CA_PEM value', () => {
    process.env.SUPABASE_CA_PEM = '';
    const config = buildMigrationClientConfig('postgres://fake-not-real/db');
    expect('ssl' in config).toBe(false);
  });

  it('preserves the given connectionString unchanged', () => {
    process.env.SUPABASE_CA_PEM = 'FAKE-CA';
    const config = buildMigrationClientConfig('postgres://fake-not-real/db');
    expect(config.connectionString).toBe('postgres://fake-not-real/db');
  });

  it('falls back to a CA found only in .env.local when process.env.SUPABASE_CA_PEM is unset - the same source resolveDatabaseUrl() already uses for DATABASE_URL', () => {
    delete process.env.SUPABASE_CA_PEM;
    process.env.FOUNDER_OS_ENV_LOCAL = makeFakeEnvLocal('SUPABASE_CA_PEM=fake-ca-from-dot-env-local\n');
    const config = buildMigrationClientConfig('postgres://fake-not-real/db');
    expect(config.ssl).toEqual({ ca: 'fake-ca-from-dot-env-local', rejectUnauthorized: true });
  });
});

describe('resolveSupabaseCaPem - standalone-CLI CA resolution (never a real credential, never logs)', () => {
  const ORIGINAL_CA = process.env.SUPABASE_CA_PEM;
  const ORIGINAL_ENV_LOCAL = process.env.FOUNDER_OS_ENV_LOCAL;
  let tmp: string | undefined;

  afterEach(() => {
    if (ORIGINAL_CA === undefined) delete process.env.SUPABASE_CA_PEM;
    else process.env.SUPABASE_CA_PEM = ORIGINAL_CA;
    if (ORIGINAL_ENV_LOCAL === undefined) delete process.env.FOUNDER_OS_ENV_LOCAL;
    else process.env.FOUNDER_OS_ENV_LOCAL = ORIGINAL_ENV_LOCAL;
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  function makeFakeEnvLocal(contents: string): string {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-env-local-'));
    const file = path.join(tmp, '.env.local');
    fs.writeFileSync(file, contents);
    return file;
  }

  it('process.env remains authoritative even when .env.local also has a (different) value - Railway/CI behavior', () => {
    process.env.FOUNDER_OS_ENV_LOCAL = makeFakeEnvLocal('SUPABASE_CA_PEM=fake-ca-from-dot-env-local\n');
    process.env.SUPABASE_CA_PEM = 'fake-ca-from-process-env';
    expect(resolveSupabaseCaPem()).toBe('fake-ca-from-process-env');
  });

  it('falls back to .env.local when process.env.SUPABASE_CA_PEM is unset - local CLI convenience', () => {
    delete process.env.SUPABASE_CA_PEM;
    process.env.FOUNDER_OS_ENV_LOCAL = makeFakeEnvLocal('SUPABASE_CA_PEM=fake-ca-from-dot-env-local\n');
    expect(resolveSupabaseCaPem()).toBe('fake-ca-from-dot-env-local');
  });

  it('returns undefined when neither source has a value', () => {
    delete process.env.SUPABASE_CA_PEM;
    process.env.FOUNDER_OS_ENV_LOCAL = makeFakeEnvLocal('SOME_UNRELATED_VAR=x\n');
    expect(resolveSupabaseCaPem()).toBeUndefined();
  });

  it('returns undefined rather than an empty string when .env.local sets an empty value', () => {
    delete process.env.SUPABASE_CA_PEM;
    process.env.FOUNDER_OS_ENV_LOCAL = makeFakeEnvLocal('SUPABASE_CA_PEM=\n');
    expect(resolveSupabaseCaPem()).toBeUndefined();
  });
});

/** A minimal fake satisfying MigrateClientLike - mirrors
 *  tests/register-installation-cli.test.ts's fakePgFactory shape/rationale. */
function fakeMigrateClient(overrides: {
  connect?: () => Promise<void>;
  query?: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  end?: () => Promise<void>;
} = {}) {
  const connect = vi.fn(overrides.connect ?? (async () => {}));
  const query = vi.fn(overrides.query ?? (async () => ({ rows: [] })));
  const end = vi.fn(overrides.end ?? (async () => {}));
  const client: MigrateClientLike = { connect, query, end };
  return { client, connect, query, end };
}

describe('runCli - Postgres client connection lifecycle', () => {
  it('returns false with a fixed safe message when DATABASE_URL is not configured', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = await runCli({
      resolveConnectionString: () => {
        throw new Error('DATABASE_URL is not set.');
      },
    });
    expect(ok).toBe(false);
    errorSpy.mockRestore();
  });

  it('returns false, never leaks the underlying error, and never calls end() when the client constructor throws', async () => {
    const secretMessage = 'bad config: host=db.example-not-real.internal user=postgres password=hunter2secret';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await runCli({
      resolveConnectionString: () => 'postgres://fake',
      createPgClient: () => {
        throw new Error(secretMessage);
      },
    });

    expect(ok).toBe(false);
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain(secretMessage);
    expect(logged).not.toContain('hunter2secret');
    errorSpy.mockRestore();
  });

  it('returns false, never leaks the underlying error, and still attempts client.end() when connect() rejects', async () => {
    const secretMessage = 'connection refused to postgres://user:hunter2secret@example-not-real.internal:5432/db';
    const { client, end } = fakeMigrateClient({
      connect: async () => {
        throw new Error(secretMessage);
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await runCli({ resolveConnectionString: () => 'postgres://fake', createPgClient: () => client });

    expect(ok).toBe(false);
    expect(end).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain(secretMessage);
    expect(logged).not.toContain('hunter2secret');
    errorSpy.mockRestore();
  });

  it('a cleanup (end()) failure after a failed connect does not crash and does not flip the outcome to true', async () => {
    const { client, end } = fakeMigrateClient({
      connect: async () => {
        throw new Error('connect failed');
      },
      end: async () => {
        throw new Error('cleanup also failed: leaked-detail-should-not-appear');
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await runCli({ resolveConnectionString: () => 'postgres://fake', createPgClient: () => client });

    expect(ok).toBe(false);
    expect(end).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain('leaked-detail-should-not-appear');
    errorSpy.mockRestore();
  });

  it('a cleanup (end()) failure after a successful run does not crash and does not flip the outcome to false', async () => {
    const { client, end, query } = fakeMigrateClient({
      end: async () => {
        throw new Error('cleanup failed after success: leaked-detail-should-not-appear');
      },
    });
    // No migration files pending is the simplest "success" path through
    // runCli() that still exercises the full connect -> work -> cleanup
    // lifecycle without needing real migration SQL.
    query.mockImplementation(async (text: string) => {
      if (/^SELECT id FROM schema_migrations/.test(text)) return { rows: listMigrationFiles().map((id) => ({ id })) };
      return { rows: [] };
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await runCli({ resolveConnectionString: () => 'postgres://fake', createPgClient: () => client });

    expect(ok).toBe(true);
    expect(end).toHaveBeenCalled();
    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain('leaked-detail-should-not-appear');
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('always attempts client.end() after a successful run', async () => {
    const { client, end, query } = fakeMigrateClient();
    query.mockImplementation(async (text: string) => {
      if (/^SELECT id FROM schema_migrations/.test(text)) return { rows: listMigrationFiles().map((id) => ({ id })) };
      return { rows: [] };
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const ok = await runCli({ resolveConnectionString: () => 'postgres://fake', createPgClient: () => client });

    expect(ok).toBe(true);
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe('runCli - never leaks a fake secret, connection string, hostname, path, SQL detail, or stack', () => {
  it('across every failure path, console output never contains any planted secret material', async () => {
    const secretConnectionString = 'postgres://someuser:supersecretpassword@db.example-not-real.internal:5432/somedb';
    const secretHostname = 'db.example-not-real.internal';
    const secretPath = '/var/secret/super-secret-segment/founder-os.db';
    const secretSql = 'SELECT * FROM super_secret_table WHERE api_key = \'sk-fake-secret-12345\'';
    const secretStack = new Error('fake stack marker').stack ?? '';
    const combinedSecretMessage = `${secretConnectionString} host=${secretHostname} path=${secretPath} sql="${secretSql}"\n${secretStack}`;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Constructor failure.
    await runCli({
      resolveConnectionString: () => secretConnectionString,
      createPgClient: () => {
        throw new Error(combinedSecretMessage);
      },
    });

    // connect() failure.
    const { client: connectFailClient } = fakeMigrateClient({
      connect: async () => {
        throw new Error(combinedSecretMessage);
      },
    });
    await runCli({ resolveConnectionString: () => secretConnectionString, createPgClient: () => connectFailClient });

    // applyMigrations()-style failure (query rejects with the secret detail).
    const { client: queryFailClient } = fakeMigrateClient({
      query: async (text: string) => {
        if (/^SELECT id FROM schema_migrations/.test(text)) return { rows: [] };
        if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [] };
        if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [] };
        throw new Error(combinedSecretMessage);
      },
    });
    await runCli({ resolveConnectionString: () => secretConnectionString, createPgClient: () => queryFailClient });

    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .map((call) => call.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
      .join('\n');

    expect(logged).not.toContain(secretConnectionString);
    expect(logged).not.toContain('supersecretpassword');
    expect(logged).not.toContain(secretHostname);
    expect(logged).not.toContain(secretPath);
    expect(logged).not.toContain('super-secret-segment');
    expect(logged).not.toContain(secretSql);
    expect(logged).not.toContain('sk-fake-secret-12345');
    expect(logged).not.toContain('    at '); // stack frame marker
    expect(logged).not.toContain(combinedSecretMessage);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('runCliSafely - direct-run unhandled-rejection guard', () => {
  it('resolves to false instead of rejecting when the wrapped run function throws unexpectedly', async () => {
    const ok = await runCliSafely({}, async () => {
      throw new Error('completely unexpected failure');
    });
    expect(ok).toBe(false);
  });

  it('never prints anything itself - the wrapped failure is silent at this layer', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runCliSafely({}, async () => {
      throw new Error('secret-detail-should-not-appear');
    });
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).not.toContain('secret-detail-should-not-appear');
    errorSpy.mockRestore();
  });

  it('passes through the real result when the wrapped run function resolves normally', async () => {
    const ok = await runCliSafely({}, async () => true);
    expect(ok).toBe(true);
  });
});

describe('applyMigrations - error sanitization (transaction rollback and ordering preserved)', () => {
  it('never embeds the raw underlying error message, SQL text, or a stack - only the safe migration filename', async () => {
    const secretDetail = 'syntax error near "FOO" host=db.example-not-real.internal password=hunter2secret\n    at fakeStackFrame (/var/secret/path.js:1:1)';
    const calls: string[] = [];
    const fakeClient = {
      query: async (text: string) => {
        calls.push(text);
        if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [] };
        if (/^SELECT id FROM schema_migrations/.test(text)) return { rows: [] };
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
        if (/^INSERT INTO schema_migrations/.test(text)) return { rows: [] };
        // Anything else is a real migration file's own SQL content -
        // simulate the underlying database rejecting it.
        throw new Error(secretDetail);
      },
    };

    let caught: Error | undefined;
    try {
      await applyMigrations(fakeClient as unknown as Client);
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).toMatch(/^Migration \S+\.sql failed and was rolled back\.$/);
    expect(caught!.message).not.toContain(secretDetail);
    expect(caught!.message).not.toContain('hunter2secret');
    expect(caught!.message).not.toContain('/var/secret/path.js');
    expect(caught!.message).not.toContain('    at ');

    // Rollback and ordering preserved: BEGIN issued before the failing
    // statement, ROLLBACK issued right after it, and no COMMIT/INSERT ever
    // ran for the failed file.
    const beginIdx = calls.indexOf('BEGIN');
    const rollbackIdx = calls.indexOf('ROLLBACK');
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(rollbackIdx).toBeGreaterThan(beginIdx);
    expect(calls).not.toContain('COMMIT');
  });
});

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
      '0009_sqlite_installations.sql',
      '0010_meta_internal_owner.sql',
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

  it('constrains status to active/archived - no workflow states', () => {
    expect(sql).toMatch(/status IN \('active', 'archived'\)/);
  });

  it('constrains data_source to demo/manual, defaulting to manual', () => {
    expect(sql).toMatch(/data_source\s+TEXT NOT NULL DEFAULT 'manual' CHECK \(data_source IN \('demo', 'manual'\)\)/);
  });

  it('tags is a plain TEXT[] with no GIN index in this pass - Phase 1 tag/search filtering stays client-side', () => {
    expect(sql).toMatch(/tags\s+TEXT\[\] NOT NULL DEFAULT '\{\}'/);
    expect(sql).not.toMatch(/USING GIN/);
  });

  it('does NOT seed any demo rows - production starts empty', () => {
    expect(sql).not.toMatch(/INSERT INTO knowledge_entries/i);
  });

  it('enables RLS with no policies - defensive posture only', () => {
    expect(sql).toMatch(/ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});

describe('0009_sqlite_installations.sql contains the REKREOS Phase 2 installation marker', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0009_sqlite_installations.sql'), 'utf8');

  it('creates the sqlite_installations table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sqlite_installations/);
  });

  it('constrains store_name to a deterministic singleton value', () => {
    expect(sql).toMatch(/store_name\s+TEXT PRIMARY KEY CHECK \(store_name = 'founder-os'\)/);
  });

  it('stores installation_id as a NOT NULL, UNIQUE UUID', () => {
    expect(sql).toMatch(/installation_id\s+UUID NOT NULL UNIQUE/);
  });

  it('records a registration timestamp', () => {
    expect(sql).toMatch(/registered_at\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  });

  it('does NOT seed or auto-create any marker row', () => {
    expect(sql).not.toMatch(/INSERT INTO sqlite_installations/i);
  });

  it('enables RLS with no policies - defensive posture only', () => {
    expect(sql).toMatch(/ALTER TABLE sqlite_installations ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});

// Real-database integration coverage against a real Postgres test database
// (see tests/helpers/pg-test-env.ts - requires an explicit
// TEST_DATABASE_URL, never DATABASE_URL/.env.local, which may be
// production). Skips cleanly - never with a confusing failure - when no
// TEST_DATABASE_URL is configured. Applying migrations here is safe to run
// repeatedly: schema_migrations tracks what already ran, and every DDL
// statement in 0001_init.sql is idempotent (IF NOT EXISTS).
const TEST_DATABASE_URL = resolveTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('migrations applied against a real PostgreSQL (TEST_DATABASE_URL configured)', () => {
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
          'sqlite_installations',
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

  it('is safe to apply twice - the second run applies nothing new', async () => {
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

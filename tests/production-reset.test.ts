import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PRESERVED_CONNECTION_ID,
  POSTGRES_RESET_TARGETS,
  buildResetConfirmationToken,
  inspectPostgresReset,
  resetPostgresBusinessData,
  inspectSqliteReset,
  resetSqliteBusinessData,
} from '@/lib/server/production-reset';

let tmp: string | undefined;

afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function makeSqlite(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'production-reset-'));
  const dbPath = path.join(tmp, 'founder-os.db');
  const db = new Database(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE installation_metadata (store_name TEXT PRIMARY KEY, installation_id TEXT NOT NULL);
    CREATE TABLE departments (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE agents (id TEXT PRIMARY KEY, department_id TEXT NOT NULL REFERENCES departments(id));
    INSERT INTO installation_metadata VALUES ('founder-os', 'keep-this-marker');
    INSERT INTO departments VALUES ('demo-dept', 'Demo');
    INSERT INTO agents VALUES ('demo-agent', 'demo-dept');
  `);
  db.close();
  return dbPath;
}

describe('production data reset safety', () => {
  it('declares every PostgreSQL business table in dependency-safe delete order', () => {
    expect(POSTGRES_RESET_TARGETS.map((target) => target.table)).toEqual([
      'meta_campaign_daily_metrics',
      'client_meta_accounts',
      'meta_sync_runs',
      'lead_events',
      'leads',
      'revenue_records',
      'knowledge_entries',
      'user_client_access',
      'integration_connections',
      'clients',
    ]);
    expect(PRESERVED_CONNECTION_ID).toBe('connection-mtcs133b-844');
  });

  it('builds a stable, opaque confirmation token from both data stores', () => {
    const token = buildResetConfirmationToken('postgres-state', 'sqlite-state');
    expect(token).toMatch(/^[a-f0-9]{24}$/);
    expect(buildResetConfirmationToken('postgres-state', 'sqlite-state')).toBe(token);
    expect(buildResetConfirmationToken('changed', 'sqlite-state')).not.toBe(token);
  });

  it('plans SQLite business deletion without exposing row contents', () => {
    const plan = inspectSqliteReset(makeSqlite());
    expect(plan.counts).toEqual({ agents: 1, departments: 1 });
    expect(plan.preservedInstallationMarkers).toBe(1);
    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(plan)).not.toContain('keep-this-marker');
  });

  it('deletes all SQLite business rows while preserving the installation marker', () => {
    const dbPath = makeSqlite();
    const before = inspectSqliteReset(dbPath);
    const result = resetSqliteBusinessData(dbPath, before.fingerprint);
    expect(result.deleted).toEqual({ agents: 1, departments: 1 });

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(db.prepare('SELECT COUNT(*) AS count FROM agents').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM departments').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM installation_metadata').get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it('refuses SQLite deletion when data changed after the dry run', () => {
    const dbPath = makeSqlite();
    const before = inspectSqliteReset(dbPath);
    const db = new Database(dbPath);
    db.prepare("INSERT INTO departments VALUES ('new-dept', 'New')").run();
    db.close();

    expect(() => resetSqliteBusinessData(dbPath, before.fingerprint)).toThrow(
      'Reset aborted because the SQLite data changed after the dry run.',
    );
    expect(inspectSqliteReset(dbPath).counts).toEqual({ agents: 1, departments: 2 });
  });

  it('refuses missing, in-memory, and corrupt SQLite sources', () => {
    expect(() => inspectSqliteReset(':memory:')).toThrow('A persistent founder-os.db is required.');
    expect(() => inspectSqliteReset(path.join(os.tmpdir(), 'missing-reset.db'))).toThrow(
      'The founder-os database is unavailable.',
    );
  });

  it('deletes PostgreSQL business rows while preserving profiles, installation markers, and Make', async () => {
    const rows = new Map<string, string[]>(
      POSTGRES_RESET_TARGETS.map((target) => [target.table, [`${target.table}-1`]]),
    );
    rows.set('profiles', ['user-1']);
    rows.set('sqlite_installations', ['founder-os:marker-1']);
    rows.set('preserved_connection', [PRESERVED_CONNECTION_ID]);
    const calls: string[] = [];
    const client = {
      async query(text: string) {
        const normalized = text.replace(/\s+/g, ' ').trim();
        calls.push(normalized);
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(normalized)) return { rows: [] };
        const selected = normalized.match(/^SELECT .+ FROM ([a-z_]+)/);
        if (selected) {
          const table = selected[1];
          const key = table === 'integration_connections' && normalized.includes('id = $1')
            ? 'preserved_connection'
            : table;
          return { rows: (rows.get(key) ?? []).map((id) => ({ id })) };
        }
        const deleted = normalized.match(/^DELETE FROM ([a-z_]+)/);
        if (deleted) {
          rows.set(deleted[1], []);
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${normalized}`);
      },
    };

    const before = await inspectPostgresReset(client);
    expect(before.preserved).toEqual({ profiles: 1, installationMarkers: 1, connections: 1 });
    await resetPostgresBusinessData(client, before.fingerprint);
    expect(calls).toContain('BEGIN');
    expect(calls).toContain('COMMIT');
    expect(rows.get('preserved_connection')).toEqual([PRESERVED_CONNECTION_ID]);
    expect(rows.get('profiles')).toEqual(['user-1']);
    expect(rows.get('sqlite_installations')).toEqual(['founder-os:marker-1']);
  });

  it('rolls back PostgreSQL deletion when data changed after the dry run', async () => {
    let ids = ['client-a'];
    const calls: string[] = [];
    const client = {
      async query(text: string) {
        const normalized = text.replace(/\s+/g, ' ').trim();
        calls.push(normalized);
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(normalized)) return { rows: [] };
        if (normalized.includes('FROM clients')) return { rows: ids.map((id) => ({ id })) };
        if (normalized.includes('FROM profiles')) return { rows: [{ id: 'user-1' }] };
        if (normalized.includes('FROM sqlite_installations')) return { rows: [{ id: 'marker' }] };
        if (normalized.includes('FROM integration_connections') && normalized.includes('id = $1')) return { rows: [{ id: PRESERVED_CONNECTION_ID }] };
        if (normalized.startsWith('SELECT')) return { rows: [] };
        if (normalized.startsWith('DELETE')) return { rows: [] };
        throw new Error(`Unexpected query: ${normalized}`);
      },
    };
    const before = await inspectPostgresReset(client);
    ids = ['client-a', 'client-b'];
    await expect(resetPostgresBusinessData(client, before.fingerprint)).rejects.toThrow(
      'Reset aborted because the Postgres data changed after the dry run.',
    );
    expect(calls).toContain('ROLLBACK');
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
  });
});

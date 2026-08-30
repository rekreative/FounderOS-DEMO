import crypto from 'node:crypto';
import fs from 'node:fs';
import Database from 'better-sqlite3';

export const PRESERVED_CONNECTION_ID = 'connection-mtcs133b-844';

export const POSTGRES_RESET_TARGETS = [
  { table: 'meta_campaign_daily_metrics', idExpression: 'id::text', where: 'TRUE' },
  { table: 'client_meta_accounts', idExpression: 'id::text', where: 'TRUE' },
  { table: 'meta_sync_runs', idExpression: 'id::text', where: 'TRUE' },
  { table: 'lead_events', idExpression: 'id::text', where: 'TRUE' },
  { table: 'leads', idExpression: 'id::text', where: 'TRUE' },
  { table: 'revenue_records', idExpression: 'id::text', where: 'TRUE' },
  { table: 'knowledge_entries', idExpression: 'id::text', where: 'TRUE' },
  {
    table: 'user_client_access',
    idExpression: "user_id::text || ':' || client_id",
    where: 'TRUE',
  },
  {
    table: 'integration_connections',
    idExpression: 'id::text',
    where: 'id <> $1',
    params: [PRESERVED_CONNECTION_ID],
  },
  { table: 'clients', idExpression: 'id::text', where: 'TRUE' },
] as const;

const SQLITE_DELETE_ORDER = [
  'broadcast_replies',
  'funnel_touches',
  'agents',
  'people',
  'sop_tasks',
  'agent_runs',
  'agent_messages',
  'broadcasts',
  'agent_tasks',
  'agent_crons',
  'contact_tags',
  'social_snapshots',
  'social_accounts',
  'email_list_snapshots',
  'social_dms',
  'social_dm_snapshots',
  'social_dm_messages',
  'social_posts',
  'lead_magnets',
  'funnel_contacts',
  'workflows',
  'skills',
  'tools',
  'roadmap_items',
  'metrics',
  'domains',
  'personas',
  'phases',
  'departments',
] as const;

const SQLITE_BUSINESS_TABLES = new Set<string>(SQLITE_DELETE_ORDER);
const INSTALLATION_TABLE = 'installation_metadata';

export interface SqliteResetInspection {
  counts: Record<string, number>;
  preservedInstallationMarkers: number;
  fingerprint: string;
}

export interface ResetPgClient {
  query(text: string, params?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

export interface PostgresResetInspection {
  counts: Record<string, number>;
  preserved: {
    profiles: number;
    installationMarkers: number;
    connections: number;
  };
  fingerprint: string;
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function buildResetConfirmationToken(
  postgresFingerprint: string,
  sqliteFingerprint: string,
): string {
  return digest({ postgresFingerprint, sqliteFingerprint }).slice(0, 24);
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_]+$/.test(value)) {
    throw new Error('Reset aborted because the SQLite schema is not recognized.');
  }
  return `"${value}"`;
}

function openExistingSqlite(sqlitePath: string): Database.Database {
  if (sqlitePath === ':memory:') {
    throw new Error('A persistent founder-os.db is required.');
  }
  if (!fs.existsSync(sqlitePath)) {
    throw new Error('The founder-os database is unavailable.');
  }
  try {
    return new Database(sqlitePath, { fileMustExist: true });
  } catch {
    throw new Error('The founder-os database is unavailable.');
  }
}

function inspectOpenSqlite(db: Database.Database): SqliteResetInspection {
  const tableRows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as { name: string }[];
  const names = tableRows.map((row) => row.name);
  const unknown = names.filter((name) => name !== INSTALLATION_TABLE && !SQLITE_BUSINESS_TABLES.has(name));
  if (unknown.length > 0) {
    throw new Error('Reset aborted because the SQLite schema is not recognized.');
  }

  const markerExists = names.includes(INSTALLATION_TABLE);
  const markerRows = markerExists
    ? db.prepare(`SELECT * FROM ${quoteIdentifier(INSTALLATION_TABLE)} ORDER BY rowid`).all()
    : [];
  if (markerRows.length !== 1) {
    throw new Error('Reset aborted because the installation marker is unavailable.');
  }

  const counts: Record<string, number> = {};
  const fingerprints: Record<string, string> = {};
  for (const table of names.filter((name) => name !== INSTALLATION_TABLE).sort()) {
    const rows = db.prepare(`SELECT * FROM ${quoteIdentifier(table)} ORDER BY rowid`).all();
    counts[table] = rows.length;
    fingerprints[table] = digest(rows);
  }

  return {
    counts,
    preservedInstallationMarkers: markerRows.length,
    fingerprint: digest({ fingerprints, installation: digest(markerRows) }),
  };
}

export function inspectSqliteReset(sqlitePath: string): SqliteResetInspection {
  const db = openExistingSqlite(sqlitePath);
  try {
    return inspectOpenSqlite(db);
  } finally {
    db.close();
  }
}

export function resetSqliteBusinessData(
  sqlitePath: string,
  expectedFingerprint: string,
): { deleted: Record<string, number> } {
  const db = openExistingSqlite(sqlitePath);
  try {
    const before = inspectOpenSqlite(db);
    if (before.fingerprint !== expectedFingerprint) {
      throw new Error('Reset aborted because the SQLite data changed after the dry run.');
    }

    const deleteRows = db.transaction(() => {
      for (const table of SQLITE_DELETE_ORDER) {
        if (Object.prototype.hasOwnProperty.call(before.counts, table)) {
          db.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
        }
      }
    });
    deleteRows();

    const after = inspectOpenSqlite(db);
    if (Object.values(after.counts).some((count) => count !== 0)) {
      throw new Error('Reset failed SQLite verification.');
    }
    return { deleted: before.counts };
  } finally {
    db.close();
  }
}

async function selectIds(
  client: ResetPgClient,
  text: string,
  params?: readonly unknown[],
): Promise<string[]> {
  const result = await client.query(text, params);
  return (result.rows as { id: string }[]).map((row) => String(row.id)).sort();
}

export async function inspectPostgresReset(client: ResetPgClient): Promise<PostgresResetInspection> {
  const identities: Record<string, string[]> = {};
  const counts: Record<string, number> = {};
  for (const target of POSTGRES_RESET_TARGETS) {
    const ids = await selectIds(
      client,
      `SELECT ${target.idExpression} AS id FROM ${target.table} WHERE ${target.where} ORDER BY id`,
      'params' in target ? target.params : undefined,
    );
    identities[target.table] = ids;
    counts[target.table] = ids.length;
  }

  const profiles = await selectIds(client, 'SELECT user_id::text AS id FROM profiles ORDER BY id');
  const installationMarkers = await selectIds(
    client,
    "SELECT store_name || ':' || installation_id::text AS id FROM sqlite_installations ORDER BY id",
  );
  const preservedConnections = await selectIds(
    client,
    'SELECT id::text AS id FROM integration_connections WHERE id = $1 ORDER BY id',
    [PRESERVED_CONNECTION_ID],
  );
  if (installationMarkers.length !== 1 || preservedConnections.length !== 1) {
    throw new Error('Reset aborted because required production markers are unavailable.');
  }

  const preserved = {
    profiles: profiles.length,
    installationMarkers: installationMarkers.length,
    connections: preservedConnections.length,
  };
  return {
    counts,
    preserved,
    fingerprint: digest({ identities, profiles, installationMarkers, preservedConnections }),
  };
}

export async function resetPostgresBusinessData(
  client: ResetPgClient,
  expectedFingerprint: string,
): Promise<{ deleted: Record<string, number> }> {
  await client.query('BEGIN');
  try {
    const before = await inspectPostgresReset(client);
    if (before.fingerprint !== expectedFingerprint) {
      throw new Error('Reset aborted because the Postgres data changed after the dry run.');
    }

    for (const target of POSTGRES_RESET_TARGETS) {
      await client.query(
        `DELETE FROM ${target.table} WHERE ${target.where}`,
        'params' in target ? target.params : undefined,
      );
    }

    const after = await inspectPostgresReset(client);
    if (
      Object.values(after.counts).some((count) => count !== 0) ||
      JSON.stringify(after.preserved) !== JSON.stringify(before.preserved)
    ) {
      throw new Error('Reset failed Postgres verification.');
    }
    await client.query('COMMIT');
    return { deleted: before.counts };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

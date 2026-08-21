import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { readEnvLocal } from '../creds';

/**
 * The smallest safe migration runner for Backend V1 — no framework. Applies
 * every lib/server/migrations/NNNN_*.sql file in filename order, tracking
 * what already ran in a schema_migrations table so re-running is a no-op for
 * anything already applied. Invoked explicitly via `npm run db:migrate` —
 * never from app/route code or page rendering. Exports its building blocks
 * (undecorated by the direct-run guard at the bottom) so tests can exercise
 * file discovery and the apply loop without triggering a CLI run on import.
 */

export const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export function resolveDatabaseUrl(): string {
  // Plain Next.js `dev`/`build` loads .env.local automatically; this script
  // runs standalone via tsx, so it falls back to the same .env.local reader
  // lib/creds.ts already uses elsewhere in the repo (no dotenv dependency
  // needed). process.env still wins when it's already set (e.g. CI).
  const url = process.env.DATABASE_URL ?? readEnvLocal().DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill in DATABASE_URL.',
    );
  }
  return url;
}

export function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort(); // filenames are zero-padded (0001_, 0002_, ...) — lexicographic sort is deterministic order
}

/** Applies every not-yet-applied migration on `client`. Returns the filenames actually run. */
export async function applyMigrations(client: Client): Promise<string[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (await client.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id),
  );

  const ran: string[] = [];
  for (const file of listMigrationFiles()) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed and was rolled back: ${(error as Error).message}`);
    }
  }
  return ran;
}

async function runCli(): Promise<void> {
  const connectionString = resolveDatabaseUrl();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const files = listMigrationFiles();
    if (files.length === 0) {
      console.log('No migration files found in lib/server/migrations/.');
      return;
    }
    const ran = await applyMigrations(client);
    const skipped = files.filter((f) => !ran.includes(f));

    for (const file of skipped) console.log(`skip   ${file} (already applied)`);
    for (const file of ran) console.log(`apply  ${file}`);
    console.log(ran.length === 0 ? 'Database already up to date.' : `Applied ${ran.length} migration(s).`);
  } finally {
    await client.end();
  }
}

// Only run the CLI when this file is executed directly (`npm run db:migrate`
// → `tsx lib/server/migrate.ts`), never when imported by a test or another
// module — importing this file must never have the side effect of touching
// a database or calling process.exit.
const isDirectRun =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runCli().catch((error) => {
    // Never print the connection string or any credential — only the error message.
    console.error('Migration failed:', error.message);
    process.exit(1);
  });
}

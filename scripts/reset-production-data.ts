import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { getSslConfig } from '../lib/server/db';
import { resolveDatabaseUrl, resolveSupabaseCaPem } from '../lib/server/migrate';
import {
  buildResetConfirmationToken,
  inspectPostgresReset,
  inspectSqliteReset,
  resetPostgresBusinessData,
  resetSqliteBusinessData,
  type ResetPgClient,
} from '../lib/server/production-reset';

type ResetClient = ResetPgClient & { connect(): Promise<void>; end(): Promise<void> };

export interface ResetCliArgs {
  sqlitePath?: string;
  execute: boolean;
  confirm?: string;
}

export function parseResetCliArgs(argv: string[]): ResetCliArgs {
  const parsed: ResetCliArgs = { execute: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--sqlite-path' && argv[index + 1]) {
      parsed.sqlitePath = argv[++index];
    } else if (argv[index] === '--execute') {
      parsed.execute = true;
    } else if (argv[index] === '--confirm' && argv[index + 1]) {
      parsed.confirm = argv[++index];
    }
  }
  return parsed;
}

export function buildResetClientConfig(connectionString: string): {
  connectionString: string;
  ssl?: { ca: string; rejectUnauthorized: true };
} {
  const ssl = getSslConfig(resolveSupabaseCaPem());
  return { connectionString, ...(ssl ? { ssl } : {}) };
}

function createClient(connectionString: string): ResetClient {
  return new Client(buildResetClientConfig(connectionString)) as unknown as ResetClient;
}

function printCounts(label: string, counts: Record<string, number>): void {
  console.log(label);
  for (const [table, count] of Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))) {
    console.log(`  ${table}: ${count}`);
  }
}

export async function runResetCli(argv: string[] = process.argv.slice(2)): Promise<boolean> {
  const args = parseResetCliArgs(argv);
  if (!args.sqlitePath) {
    console.error('Usage: reset:production-data --sqlite-path <path> [--execute --confirm <token>]');
    return false;
  }

  let client: ResetClient | undefined;
  try {
    const connectionString = resolveDatabaseUrl();
    client = createClient(connectionString);
    await client.connect();

    const postgres = await inspectPostgresReset(client);
    const sqlite = inspectSqliteReset(args.sqlitePath);
    const confirmationToken = buildResetConfirmationToken(postgres.fingerprint, sqlite.fingerprint);

    printCounts('Postgres rows selected for deletion:', postgres.counts);
    printCounts('SQLite rows selected for deletion:', sqlite.counts);
    console.log(`Preserved profiles: ${postgres.preserved.profiles}`);
    console.log(`Preserved installation markers: ${postgres.preserved.installationMarkers + sqlite.preservedInstallationMarkers}`);
    console.log(`Preserved internal connections: ${postgres.preserved.connections}`);

    if (!args.execute) {
      console.log(`Dry run only. Confirmation token: ${confirmationToken}`);
      console.log('No data was changed.');
      return true;
    }
    if (args.confirm !== confirmationToken) {
      console.error('Reset aborted: confirmation token is missing, incorrect, or stale.');
      return false;
    }

    await resetPostgresBusinessData(client, postgres.fingerprint);
    resetSqliteBusinessData(args.sqlitePath, sqlite.fingerprint);
    console.log('Production demo and test data was deleted and verified.');
    console.log('Users, installation markers, schemas, backups, and the internal Make connection were preserved.');
    return true;
  } catch {
    console.error('Production data reset failed safely. Review the latest verified backup before retrying.');
    return false;
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // Cleanup errors are deliberately hidden because connection details
        // may be present in the underlying driver error.
      }
    }
  }
}

const isDirectRun =
  process.argv[1] != null &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runResetCli().then((ok) => {
    process.exitCode = ok ? 0 : 1;
  });
}

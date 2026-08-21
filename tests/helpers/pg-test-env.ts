import fs from 'node:fs';
import path from 'node:path';
import { parseEnvFile } from '@/lib/creds';

/**
 * Resolves DATABASE_URL for integration tests against the real local dev
 * Postgres. Deliberately reads the actual .env.local at the repo root
 * directly via parseEnvFile — NOT through lib/creds.ts's readEnvLocal(),
 * which vitest.config.ts points at a nonexistent file
 * (FOUNDER_OS_ENV_LOCAL) specifically so *external service* credentials
 * (Slack, email, social) never leak into a test run. DATABASE_URL here
 * names a local-only dev database — the whole point of this pass's
 * integration tests is to exercise it, so that guard doesn't apply.
 * Returns undefined (never throws) when no DATABASE_URL is configured,
 * so callers can skip cleanly via `describe.runIf`.
 */
export function resolveTestDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    return parseEnvFile(raw).DATABASE_URL || undefined;
  } catch {
    return undefined;
  }
}

/** Sets process.env.DATABASE_URL for the current test file, if resolvable. */
export function installTestDatabaseUrl(): string | undefined {
  const url = resolveTestDatabaseUrl();
  if (url) process.env.DATABASE_URL = url;
  return url;
}

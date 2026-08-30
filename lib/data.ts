import path from 'node:path';
import fs from 'node:fs';
import { openDb, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { isServerDemoDataEnabled } from '@/lib/demo-data';

/**
 * App-level singleton. Larp-first, real-ready: every page and API route reads
 * through this seeded SQLite database, so swapping in live sources later is a
 * repo-level change, not a UI rewrite.
 */
let instance: FounderDb | null = null;

const REQUIRE_EXISTING_DB_FLAG = 'FOUNDER_OS_REQUIRE_EXISTING_DB';

/**
 * Thrown by getDb() when FOUNDER_OS_REQUIRE_EXISTING_DB=true and the
 * configured founder-os database is missing. Deliberately carries no path or
 * other detail in its message - it is safe to let this propagate into any
 * generic error handling without leaking where the database lives. See
 * docs/deployment.md's "Production SQLite recreation guard" section for the
 * production rollout this exists for.
 */
export class FounderDbMissingError extends Error {
  constructor() {
    super('founder-os database is required to already exist but was not found');
    this.name = 'FounderDbMissingError';
  }
}

export function getDb(): FounderDb {
  if (instance) return instance;
  const dbPath = process.env.FOUNDER_OS_DB ?? path.join(process.cwd(), 'data', 'founder-os.db');

  // Production recreation guard (Observability Phase 1). Checked before any
  // directory or file is created: when this flag is exactly 'true', a
  // missing founder-os.db is a lost/reset volume, never a "fresh
  // environment, seed it" signal, so it must fail loudly instead of being
  // silently replaced by an empty, freshly-seeded database. Local dev and
  // tests never set this flag, so their auto-create-and-seed behavior below
  // is completely unchanged. A required ':memory:' path is intentionally
  // exempt - it never persists across process boundaries, so "missing" is
  // meaningless for it.
  if (
    process.env[REQUIRE_EXISTING_DB_FLAG] === 'true' &&
    dbPath !== ':memory:' &&
    !fs.existsSync(dbPath)
  ) {
    throw new FounderDbMissingError();
  }

  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  instance = openDb(dbPath);
  // Seed on first touch so a fresh clone boots looking alive. Each clause
  // back-fills databases created before that table existed; seedDatabase is
  // idempotent (INSERT OR REPLACE), so re-running only adds what's missing.
  if (
    isServerDemoDataEnabled() &&
    (
      instance.departments.all().length === 0 ||
      instance.workflows.all().length === 0 ||
      instance.skills.all().length === 0 ||
      instance.social.accounts().length === 0 ||
      instance.emailList.snapshots().length === 0 ||
      instance.social.dmSnapshots().length === 0 ||
      instance.social.dmMessages().length === 0 ||
      instance.leadMagnets.all().length === 0
    )
  ) {
    seedDatabase(instance);
  }
  return instance;
}

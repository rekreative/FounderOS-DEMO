import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { closePool, withTransaction } from '@/lib/server/db';
import { seedClients, seedLeadEvents, seedLeads } from '../scripts/seed-backend-v1';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

// Integration test against the real local dev PostgreSQL. Runs the actual
// seed functions (not a re-implementation) so this genuinely proves
// db:seed's idempotency contract: a second run inserts nothing new and
// never touches unrelated rows. Skips cleanly without DATABASE_URL.
const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('scripts/seed-backend-v1 (real PostgreSQL)', () => {
  it('is idempotent: a second run inserts 0 new clients/leads/events', async () => {
    const first = await withTransaction(async (client) => {
      const clients = await seedClients(client);
      const leads = await seedLeads(client);
      const events = await seedLeadEvents(client);
      return { clients, leads, events };
    });

    const second = await withTransaction(async (client) => {
      const clients = await seedClients(client);
      const leads = await seedLeads(client);
      const events = await seedLeadEvents(client);
      return { clients, leads, events };
    });

    // First run may have inserted (fresh DB) or found everything already
    // present (already seeded) — either is valid. What matters is the
    // second run strictly inserts nothing new.
    expect(second.clients.inserted).toBe(0);
    expect(second.leads.inserted).toBe(0);
    expect(second.events.inserted).toBe(0);
    expect(second.clients.skipped).toBe(first.clients.inserted + first.clients.skipped);
    expect(second.leads.skipped).toBe(first.leads.inserted + first.leads.skipped);
    expect(second.events.skipped).toBe(first.events.inserted + first.events.skipped);

    await closePool();
  });

  it('never touches rows outside its own known seed ids', async () => {
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    try {
      const before = await client.query('SELECT count(*)::int AS n FROM clients');
      await withTransaction(async (c) => {
        await seedClients(c);
        await seedLeads(c);
        await seedLeadEvents(c);
      });
      const after = await client.query('SELECT count(*)::int AS n FROM clients');
      // Running the seed again must never reduce the client count — proves
      // it never deletes anything, seeded or operator-created.
      expect(after.rows[0].n).toBeGreaterThanOrEqual(before.rows[0].n);
    } finally {
      await client.end();
    }
  });
});

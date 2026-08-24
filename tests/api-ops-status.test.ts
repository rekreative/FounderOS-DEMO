import { afterAll, describe, expect, it } from 'vitest';
import { closePool } from '@/lib/server/db';
import { GET } from '@/app/api/ops/status/route';
import { installTestDatabaseUrl } from './helpers/pg-test-env';

const TEST_DATABASE_URL = installTestDatabaseUrl();

describe.runIf(Boolean(TEST_DATABASE_URL))('GET /api/ops/status (real PostgreSQL)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('200s with the full snapshot shape', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.postgres).toBeDefined();
    expect(Array.isArray(body.connections)).toBe(true);
    expect(body.connections.map((c: { id: string }) => c.id).sort()).toEqual(
      ['google_sheets', 'make', 'meta_ads', 'openai', 'postgresql', 'whatsapp'].sort(),
    );
    expect(Array.isArray(body.automations)).toBe(true);
    expect(body.automations.map((a: { id: string }) => a.id).sort()).toEqual(
      ['commercial_lifecycle', 'lead_intake', 'lead_qualification', 'whatsapp_inbound', 'whatsapp_outbound'].sort(),
    );
    expect(body.agent).toBeDefined();
    expect(body.agent.id).toBe('lead_qualification_agent');
    expect(Array.isArray(body.attention)).toBe(true);
  });

  it('never returns DATABASE_URL, API keys, or any other secret value', async () => {
    const res = await GET();
    const raw = await res.text();

    expect(raw).not.toContain(TEST_DATABASE_URL);
    expect(raw).not.toMatch(/postgres(ql)?:\/\//i);
    if (process.env.INGEST_API_KEY) expect(raw).not.toContain(process.env.INGEST_API_KEY);
    if (process.env.MAKE_EVENTS_API_KEY) expect(raw).not.toContain(process.env.MAKE_EVENTS_API_KEY);
    expect(raw.toLowerCase()).not.toContain('"database_url"');
  });
});

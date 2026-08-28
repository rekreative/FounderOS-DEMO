import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Legacy `/integrations` retirement (Visual QA correction, 2026-08-28):
 * superseded the earlier "keep it read-only" decision. This suite proves,
 * at the source level, that no path back to the marketplace UI or its
 * secret-write surface remains — functional redirect behavior itself
 * (redirect() throwing NEXT_REDIRECT to /connections) is covered by
 * tests/smoke.test.ts's PAGES entry for 'integrations/page.tsx'.
 */
describe('/integrations no longer renders the legacy marketplace', () => {
  const page = read('app/(internal)/integrations/page.tsx');

  test('the page body does nothing but redirect — no marketplace component is imported or rendered', () => {
    expect(page).toMatch(/redirect\('\/connections'\)/);
    for (const symbol of [
      'ApiKeys',
      'ConnectFlow',
      'ConnectionCard',
      'connectionCatalog',
      'integrationsByCategory',
      'allConnectorStatuses',
      'IntegrationCategory',
      'PageHeader',
    ]) {
      expect(page).not.toContain(symbol);
    }
  });

  test('the removed secret-write routes and components have not been restored', () => {
    for (const removed of [
      'app/api/connections/connect/route.ts',
      'app/api/keys/route.ts',
      'components/ApiKeys.tsx',
      'components/ConnectFlow.tsx',
      'lib/keys.ts',
    ]) {
      expect(existsSync(join(process.cwd(), removed)), `${removed} must stay removed`).toBe(false);
    }
  });

  test('GET /api/connections (the real connector-status feed Sidebar depends on) is still present', () => {
    expect(existsSync(join(process.cwd(), 'app/api/connections/route.ts'))).toBe(true);
    const route = read('app/api/connections/route.ts');
    expect(route).toMatch(/export async function GET/);
  });

  test('the canonical Connections/Secrets V1 Postgres surface is untouched by this correction', () => {
    for (const kept of [
      'lib/server/migrations/0008_integration_connections.sql',
      'lib/server/integration-connections-repo.ts',
      'app/api/integration-connections/route.ts',
      'app/api/integration-connections/[id]/route.ts',
      'lib/api/integration-connections.ts',
      'app/(internal)/connections/page.tsx',
      'components/IntegrationConnectionsBoard.tsx',
    ]) {
      expect(existsSync(join(process.cwd(), kept)), `${kept} must still exist`).toBe(true);
    }
  });
});

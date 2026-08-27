import { beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

beforeAll(() => {
  process.env.FOUNDER_OS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'founder-os-apismoke-')), 'test.db');
  process.env.FUNNEL_PROVIDER = 'seed'; // keep /api/funnel off the live Attio API in tests
});

type RouteEntry = {
  route: string; // path under app/api, source of truth for coverage
  load: () => Promise<{ GET?: (req: Request, ctx?: any) => unknown }>;
  url: string; // includes any required query params
  params?: Record<string, string>; // for dynamic [param] routes
};

// Every app/api/**/route.ts that exports GET, with valid params so each returns
// a real 200 (not a 400/404 for a missing arg). Live-connector routes
// (connections, social/sync) must still answer 200 with honest state.
const ROUTES: RouteEntry[] = [
  { route: 'agents', load: () => import('@/app/api/agents/route'), url: 'http://localhost/api/agents' },
  { route: 'lead-magnets', load: () => import('@/app/api/lead-magnets/route'), url: 'http://localhost/api/lead-magnets' },
  { route: 'agents/activity', load: () => import('@/app/api/agents/activity/route'), url: 'http://localhost/api/agents/activity?limit=5' },
  { route: 'agents/broadcast', load: () => import('@/app/api/agents/broadcast/route'), url: 'http://localhost/api/agents/broadcast' },
  { route: 'agents/work', load: () => import('@/app/api/agents/work/route'), url: 'http://localhost/api/agents/work?agentId=data-agent' },
  { route: 'brain', load: () => import('@/app/api/brain/route'), url: 'http://localhost/api/brain' },
  { route: 'brain/graph', load: () => import('@/app/api/brain/graph/route'), url: 'http://localhost/api/brain/graph' },
  { route: 'brain/overview', load: () => import('@/app/api/brain/overview/route'), url: 'http://localhost/api/brain/overview' },
  { route: 'comms', load: () => import('@/app/api/comms/route'), url: 'http://localhost/api/comms' },
  { route: 'conductor/context', load: () => import('@/app/api/conductor/context/route'), url: 'http://localhost/api/conductor/context?path=/agents' },
  { route: 'connections', load: () => import('@/app/api/connections/route'), url: 'http://localhost/api/connections' },
  { route: 'contacts/tags', load: () => import('@/app/api/contacts/tags/route'), url: 'http://localhost/api/contacts/tags' },
  { route: 'departments', load: () => import('@/app/api/departments/route'), url: 'http://localhost/api/departments' },
  { route: 'funnel', load: () => import('@/app/api/funnel/route'), url: 'http://localhost/api/funnel' },
  { route: 'funnel/lead-message', load: () => import('@/app/api/funnel/lead-message/route'), url: 'http://localhost/api/funnel/lead-message?name=Smoke%20Test%20Lead' },
  { route: 'health', load: () => import('@/app/api/health/route'), url: 'http://localhost/api/health' },
  { route: 'keys', load: () => import('@/app/api/keys/route'), url: 'http://localhost/api/keys' },
  { route: 'life/map', load: () => import('@/app/api/life/map/route'), url: 'http://localhost/api/life/map' },
  { route: 'metrics', load: () => import('@/app/api/metrics/route'), url: 'http://localhost/api/metrics' },
  { route: 'roadmap', load: () => import('@/app/api/roadmap/route'), url: 'http://localhost/api/roadmap' },
  { route: 'social', load: () => import('@/app/api/social/route'), url: 'http://localhost/api/social' },
  { route: 'social/[platform]', load: () => import('@/app/api/social/[platform]/route'), url: 'http://localhost/api/social/instagram', params: { platform: 'instagram' } },
  { route: 'social/history', load: () => import('@/app/api/social/history/route'), url: 'http://localhost/api/social/history?limit=6' },
  { route: 'social/posts', load: () => import('@/app/api/social/posts/route'), url: 'http://localhost/api/social/posts' },
  { route: 'social/series', load: () => import('@/app/api/social/series/route'), url: 'http://localhost/api/social/series?metric=audience' },
  { route: 'social/sync', load: () => import('@/app/api/social/sync/route'), url: 'http://localhost/api/social/sync' },
  { route: 'tools', load: () => import('@/app/api/tools/route'), url: 'http://localhost/api/tools' },
  { route: 'ventures', load: () => import('@/app/api/ventures/route'), url: 'http://localhost/api/ventures' },
  { route: 'webhooks/manychat', load: () => import('@/app/api/webhooks/manychat/route'), url: 'http://localhost/api/webhooks/manychat' },
];

function discoverGetRoutes(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...discoverGetRoutes(path.join(dir, entry.name), rel));
    else if (entry.name === 'route.ts') {
      const src = readFileSync(path.join(dir, entry.name), 'utf8');
      if (/export\s+(async\s+)?function\s+GET/.test(src)) out.push(rel.replace(/\/route\.ts$/, ''));
    }
  }
  return out;
}

describe('platform smoke — every GET API route answers 200 with JSON', () => {
  test.each(ROUTES)('GET /api/$route', async ({ load, url, params }) => {
    const mod = await load();
    expect(mod.GET, 'route should export GET').toBeTypeOf('function');
    const res = (await mod.GET!(new Request(url), { params })) as Response;
    expect(res.status, `GET ${url} should be 200 (honest state, not 500/400)`).toBe(200);
    const body = await res.json();
    expect(body && typeof body === 'object').toBe(true);
  }, 20_000);

  test('the API smoke net covers every GET route under app/api (no route escapes)', () => {
    // skills/[slug] reads the local ~/.claude/skills dir at runtime (404 without
    // a slug on disk), so it is not a 200-required smoke route.
    // Backend V1's clients/leads routes, plus Results Real + Home Real V1's
    // results routes, read real PostgreSQL (DATABASE_URL), not the
    // throwaway SQLite temp db this file uses — they have their own full
    // 200-path integration coverage against a real dev database in
    // tests/api-clients.test.ts, tests/api-leads.test.ts, and
    // tests/api-results.test.ts (all skip cleanly without DATABASE_URL,
    // same as this file has zero DB dependency by design). ops/status (Real
    // V1 operational-evidence snapshot) is the same shape of route — its
    // full 200-path coverage lives in tests/api-ops-status.test.ts.
    // Meta Ads Real V1's meta-ads/accounts and meta-ads/campaigns routes are
    // the same shape again (real PostgreSQL only) — full coverage lives in
    // tests/api-meta-ads-accounts.test.ts and tests/api-meta-ads-campaigns.test.ts.
    // Results Manual Revenue V1's revenue-records route is the same shape
    // once more (real PostgreSQL only, requires a clientId) — full coverage
    // lives in tests/api-revenue-records.test.ts.
    // ready (Deployment Health V1) is the same shape once more — it pings
    // real PostgreSQL and honestly returns 503 (not 200) when unreachable,
    // which this SQLite-only smoke net can't satisfy by design. Full
    // 200-and-503-path coverage lives in tests/ready-route.test.ts. health
    // itself is DB-free (pure process liveness) so it's covered above in
    // ROUTES like any other always-200 route.
    const IGNORE = new Set([
      'skills/[slug]',
      'clients',
      'clients/[id]',
      'leads',
      'leads/[id]',
      'leads/[id]/events',
      'results',
      'results/home',
      'ops/status',
      'ops/status/client/[clientId]',
      'meta-ads/accounts',
      'meta-ads/campaigns',
      'ready',
      'revenue-records',
    ]);
    const discovered = discoverGetRoutes(path.join(process.cwd(), 'app', 'api')).filter((r) => !IGNORE.has(r)).sort();
    const covered = ROUTES.map((r) => r.route).sort();
    expect(covered).toEqual(discovered);
  });
});

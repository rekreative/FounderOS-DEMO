import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { M2M_PATHS } from '@/lib/server/m2m-routes';

/**
 * Structural regression, independent of the global "always internal" test
 * default (tests/setup.ts) — this file never imports/calls any route
 * handler and never relies on that mock at all. It reads SOURCE TEXT
 * directly, so it cannot be fooled the way a runtime test could be if a
 * route silently lost its guard while the global mock kept its old test
 * passing.
 *
 * Walks the real app/api filesystem — not a hand-maintained list — so it
 * fails automatically the moment any of these drifts from reality:
 *   - a new internal-human route is added without the guard
 *   - an existing route loses its guard
 *   - a route is added to (or removed from) lib/server/m2m-routes.ts's
 *     M2M_PATHS without a matching change here (this file enforces the
 *     OTHER half of that invariant: M2M routes must NOT import the human
 *     API auth helper at all)
 *
 * METHOD-AWARE (Tenant/API Authorization V1): a route.ts file is no longer
 * one guard for the whole file — a mixed-method file (e.g. GET /api/leads
 * tenant-scoped, POST /api/leads internal-only) legitimately imports both
 * requireClientAccessOrResponse/requireUserOrResponse AND
 * requireInternalUserOrResponse. Checking "does this file's source mention
 * the internal guard anywhere" would pass a GET that lost its guard entirely
 * as long as a sibling POST in the same file still had one, and would fail
 * a route (like GET /api/results) that is legitimately 100% tenant-scoped
 * and never imports the internal guard at all. So each exported HTTP method
 * is sliced out of the file and checked independently: every write method
 * (POST/PUT/PATCH/DELETE) must use requireInternalUserOrResponse; every GET
 * must use requireInternalUserOrResponse UNLESS its route is in the
 * TENANT_READ_ROUTES allowlist below, in which case it must use one of the
 * tenant guards instead — never both, and never neither.
 */

const APP_API_DIR = path.join(process.cwd(), 'app', 'api');
const GUARD_IMPORT_SPECIFIER = '@/lib/server/api-auth';
const INTERNAL_GUARD = 'requireInternalUserOrResponse';
const TENANT_GUARDS = ['requireClientAccessOrResponse', 'requireUserOrResponse'] as const;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * The exhaustive, reviewed set of READ routes approved to be tenant-aware
 * instead of internal-only (Tenant/API Authorization V1 architecture
 * requirement #1: only these become tenant-aware; every other GET, and
 * every write method everywhere, stays internal-only). Mirrors
 * tests/tenant-access.test.ts's functional coverage of the same routes.
 */
const TENANT_READ_ROUTES: ReadonlySet<string> = new Set([
  '/api/clients/[id]',
  '/api/leads',
  '/api/leads/[id]',
  '/api/leads/[id]/events',
  '/api/results',
  '/api/meta-ads/campaigns',
  '/api/meta-ads/accounts',
  '/api/ops/status/client/[clientId]',
]);

/**
 * Deployment status check(s) — genuinely public, no api-auth guard, and
 * deliberately NOT M2M: M2M_PATHS (lib/server/m2m-routes.ts) is reserved for
 * bearer/shared-secret-authenticated integrations, whereas a liveness/
 * readiness probe has no credential at all. See app/api/health/route.ts,
 * app/api/ready/route.ts, and middleware.ts's PUBLIC_STATUS_PATHS exception.
 */
const PUBLIC_UNAUTHENTICATED_ROUTES: ReadonlySet<string> = new Set(['/api/health', '/api/ready']);

function discoverRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...discoverRouteFiles(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

/** app/api/ingest/leads/route.ts → /api/ingest/leads (matches M2M_PATHS' format exactly). */
function toRoutePath(absoluteFile: string): string {
  const rel = path.relative(path.join(process.cwd(), 'app'), absoluteFile);
  const withoutRouteFile = rel.slice(0, -'/route.ts'.length).replace(/\\/g, '/');
  return `/${withoutRouteFile}`;
}

function fileImportsFromApiAuth(source: string, identifier: string): boolean {
  const importBlock = source.match(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${GUARD_IMPORT_SPECIFIER}['"]`));
  if (!importBlock) return false;
  return importBlock[1]
    .split(',')
    .map((s) => s.trim())
    .includes(identifier);
}

function importsAnyApiAuthGuard(source: string): boolean {
  return new RegExp(`from ['"]${GUARD_IMPORT_SPECIFIER}['"]`).test(source);
}

/**
 * Splits a route.ts file's source into one text slice per exported HTTP
 * method handler — every handler in these files is a top-level
 * `export async function METHOD(` sibling, never nested inside another, so
 * "from this method's declaration to the next one" is a safe, simple
 * boundary without needing a real parser.
 */
function extractMethodBodies(source: string): Partial<Record<(typeof HTTP_METHODS)[number], string>> {
  const pattern = new RegExp(`export async function (${HTTP_METHODS.join('|')})\\s*\\(`, 'g');
  const matches = [...source.matchAll(pattern)];
  const bodies: Partial<Record<(typeof HTTP_METHODS)[number], string>> = {};
  matches.forEach((match, i) => {
    const start = match.index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : source.length;
    bodies[match[1] as (typeof HTTP_METHODS)[number]] = source.slice(start, end);
  });
  return bodies;
}

const routeFiles = discoverRouteFiles(APP_API_DIR);

describe('every internal-human API route method is wired to the correct api-auth guard — filesystem-driven, method-aware', () => {
  it('sanity check: the walk actually found route files, and found more than just the M2M set', () => {
    // A silent filesystem/path bug in this test would make every other
    // assertion below vacuously pass over an empty list — guard against that.
    expect(routeFiles.length).toBeGreaterThan(M2M_PATHS.size);
  });

  const internalRoutes = routeFiles.filter(
    (f) => !M2M_PATHS.has(toRoutePath(f)) && !PUBLIC_UNAUTHENTICATED_ROUTES.has(toRoutePath(f)),
  );
  const m2mRoutes = routeFiles.filter((f) => M2M_PATHS.has(toRoutePath(f)));
  const publicRoutes = routeFiles.filter((f) => PUBLIC_UNAUTHENTICATED_ROUTES.has(toRoutePath(f)));

  it(`found ${m2mRoutes.length} of the ${M2M_PATHS.size} declared M2M routes on disk — catches a renamed/moved/deleted M2M route`, () => {
    expect(m2mRoutes.length).toBe(M2M_PATHS.size);
  });

  const foundTenantReadRoutes = internalRoutes.filter((f) => TENANT_READ_ROUTES.has(toRoutePath(f)));
  it(`found ${foundTenantReadRoutes.length} of the ${TENANT_READ_ROUTES.size} declared tenant-aware READ routes on disk — catches a renamed/moved/deleted tenant route`, () => {
    expect(foundTenantReadRoutes.length).toBe(TENANT_READ_ROUTES.size);
  });

  const methodCases = internalRoutes.flatMap((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const bodies = extractMethodBodies(source);
    return Object.entries(bodies).map(([method, body]) => ({
      routePath: toRoutePath(file),
      file,
      source,
      method: method as (typeof HTTP_METHODS)[number],
      body: body!,
    }));
  });

  it('sanity check: at least one GET and one write method were actually found across internal routes', () => {
    expect(methodCases.some((c) => c.method === 'GET')).toBe(true);
    expect(methodCases.some((c) => c.method !== 'GET')).toBe(true);
  });

  it.each(methodCases.map((c) => [`${c.method} ${c.routePath}`, c] as const))('%s uses the correct api-auth guard', (_label, c) => {
    const isTenantAware = c.method === 'GET' && TENANT_READ_ROUTES.has(c.routePath);
    const rel = path.relative(process.cwd(), c.file);

    if (isTenantAware) {
      const usesTenantGuard = TENANT_GUARDS.some((g) => fileImportsFromApiAuth(c.source, g) && c.body.includes(g));
      expect(usesTenantGuard, `${c.method} ${c.routePath} (${rel}) is an approved tenant-read route but doesn't call a tenant guard`).toBe(true);
      expect(
        c.body.includes(INTERNAL_GUARD),
        `${c.method} ${c.routePath} (${rel}) is an approved tenant-read route and must not also gate itself with requireInternalUserOrResponse()`,
      ).toBe(false);
    } else {
      const usesInternalGuard = fileImportsFromApiAuth(c.source, INTERNAL_GUARD) && c.body.includes(INTERNAL_GUARD);
      expect(
        usesInternalGuard,
        `${c.method} ${c.routePath} (${rel}) is not an approved tenant-read route, so it must stay gated by requireInternalUserOrResponse()`,
      ).toBe(true);
    }
  });

  it.each(m2mRoutes.map((f) => [toRoutePath(f), f] as const))(
    'M2M route %s does NOT import any api-auth guard — it must remain governed only by its own bearer/shared-secret check',
    (_routePath, file) => {
      const source = fs.readFileSync(file, 'utf8');
      expect(
        importsAnyApiAuthGuard(source),
        `${toRoutePath(file)} (${path.relative(process.cwd(), file)}) is classified as M2M but imports an api-auth guard — ` +
          'either it is no longer M2M and must be removed from lib/server/m2m-routes.ts, or this guard was added by mistake',
      ).toBe(false);
    },
  );

  it(`found ${publicRoutes.length} of the ${PUBLIC_UNAUTHENTICATED_ROUTES.size} declared public unauthenticated routes on disk — catches a renamed/moved/deleted health route`, () => {
    expect(publicRoutes.length).toBe(PUBLIC_UNAUTHENTICATED_ROUTES.size);
  });

  it.each(publicRoutes.map((f) => [toRoutePath(f), f] as const))(
    'public route %s does NOT import any api-auth guard — it must remain genuinely unauthenticated',
    (_routePath, file) => {
      const source = fs.readFileSync(file, 'utf8');
      expect(
        importsAnyApiAuthGuard(source),
        `${toRoutePath(file)} (${path.relative(process.cwd(), file)}) is classified as a public unauthenticated route but imports an api-auth guard — ` +
          'either it needs real auth and must be removed from PUBLIC_UNAUTHENTICATED_ROUTES, or this guard was added by mistake',
      ).toBe(false);
    },
  );
});

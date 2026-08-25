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
 */

const APP_API_DIR = path.join(process.cwd(), 'app', 'api');
const GUARD_IMPORT_SPECIFIER = '@/lib/server/api-auth';
const GUARD_IDENTIFIER = 'requireInternalUserOrResponse';

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

function importsGuard(source: string): boolean {
  const hasImportLine = new RegExp(`from ['"]${GUARD_IMPORT_SPECIFIER}['"]`).test(source);
  const usesIdentifier = source.includes(GUARD_IDENTIFIER);
  return hasImportLine && usesIdentifier;
}

const routeFiles = discoverRouteFiles(APP_API_DIR);

describe('every internal-human API route is wired to requireInternalUserOrResponse() — filesystem-driven, not a hardcoded count', () => {
  it('sanity check: the walk actually found route files, and found more than just the M2M set', () => {
    // A silent filesystem/path bug in this test would make every other
    // assertion below vacuously pass over an empty list — guard against that.
    expect(routeFiles.length).toBeGreaterThan(M2M_PATHS.size);
  });

  const internalRoutes = routeFiles.filter((f) => !M2M_PATHS.has(toRoutePath(f)));
  const m2mRoutes = routeFiles.filter((f) => M2M_PATHS.has(toRoutePath(f)));

  it(`found ${m2mRoutes.length} of the ${M2M_PATHS.size} declared M2M routes on disk — catches a renamed/moved/deleted M2M route`, () => {
    expect(m2mRoutes.length).toBe(M2M_PATHS.size);
  });

  it.each(internalRoutes.map((f) => [toRoutePath(f), f] as const))(
    '%s imports and uses requireInternalUserOrResponse()',
    (_routePath, file) => {
      const source = fs.readFileSync(file, 'utf8');
      expect(importsGuard(source), `${toRoutePath(file)} (${path.relative(process.cwd(), file)}) is missing the internal-auth guard`).toBe(true);
    },
  );

  it.each(m2mRoutes.map((f) => [toRoutePath(f), f] as const))(
    'M2M route %s does NOT import requireInternalUserOrResponse() — it must remain governed only by its own bearer/shared-secret check',
    (_routePath, file) => {
      const source = fs.readFileSync(file, 'utf8');
      expect(
        importsGuard(source),
        `${toRoutePath(file)} (${path.relative(process.cwd(), file)}) is classified as M2M but imports the human-auth guard — ` +
          'either it is no longer M2M and must be removed from lib/server/m2m-routes.ts, or this guard was added by mistake',
      ).toBe(false);
    },
  );
});

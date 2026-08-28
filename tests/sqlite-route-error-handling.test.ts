import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Observability Phase 1, Pass 2 — safe unexpected-error handling for every
 * founder-os SQLite-backed app/api/**\/route.ts exported handler.
 *
 * This is a data-driven regression net, not one copy-pasted test per route:
 * SQLITE_ROUTE_INVENTORY below is the exact, exhaustive inventory of files
 * and exported methods this pass touched (confirmed by grepping app/api for
 * `getDb(` and tracing every indirect caller — see the pass's own report for
 * the full trace). The inventory test proves every one of them still has an
 * `unexpectedError(...)` boundary; the executable tests below it exercise a
 * representative sample end to end (collection GET, dynamic [id]/[platform]
 * GET, a mutation, and a structurally different nested+dynamic route),
 * mocking only the repository layer — never a real database, agent,
 * connector, or network call.
 */

const ROOT = process.cwd();

type RouteEntry = {
  file: string;
  methods: string[];
  /** Set only for a route whose methods delegate to one shared, unexported
   *  helper function that owns the actual try/catch (e.g. social/sync's
   *  GET and POST both call runSync()) — checked instead of the method body
   *  itself in that case. */
  sharedHelper?: string;
};

const SQLITE_ROUTE_INVENTORY: RouteEntry[] = [
  { file: 'app/api/agents/route.ts', methods: ['GET'] },
  { file: 'app/api/agents/[id]/chat/route.ts', methods: ['POST'] },
  { file: 'app/api/agents/[id]/run/route.ts', methods: ['POST'] },
  { file: 'app/api/agents/activity/route.ts', methods: ['GET'] },
  { file: 'app/api/agents/broadcast/route.ts', methods: ['GET', 'POST'] },
  { file: 'app/api/agents/work/route.ts', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  { file: 'app/api/contacts/tags/route.ts', methods: ['GET', 'POST', 'DELETE'] },
  { file: 'app/api/departments/route.ts', methods: ['GET'] },
  { file: 'app/api/funnel/route.ts', methods: ['GET'] },
  { file: 'app/api/lead-magnets/route.ts', methods: ['GET', 'POST'] },
  { file: 'app/api/lead-magnets/[id]/route.ts', methods: ['PATCH', 'DELETE'] },
  { file: 'app/api/metrics/route.ts', methods: ['GET'] },
  { file: 'app/api/roadmap/route.ts', methods: ['GET'] },
  { file: 'app/api/social/route.ts', methods: ['GET'] },
  { file: 'app/api/social/[platform]/route.ts', methods: ['GET'] },
  { file: 'app/api/social/series/route.ts', methods: ['GET'] },
  { file: 'app/api/social/posts/route.ts', methods: ['GET', 'POST'] },
  { file: 'app/api/social/sync/route.ts', methods: ['GET', 'POST'], sharedHelper: 'runSync' },
  { file: 'app/api/social/dm/reply/route.ts', methods: ['POST'] },
  { file: 'app/api/tools/route.ts', methods: ['GET'] },
  { file: 'app/api/webhooks/manychat/route.ts', methods: ['POST'] },
];

/** Extracts one exported `export async function NAME(...) { ... }` block
 *  from a route file's source, up to (not including) the next top-level
 *  export or end of file. Throws if NAME isn't exported at all, which fails
 *  the test loudly rather than silently skipping a method. */
function extractExportedFunction(source: string, name: string, filePath: string): string {
  const re = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${name}\\s*\\([\\s\\S]*?(?=\\nexport\\s+(?:async\\s+)?function\\s+\\w+\\s*\\(|$)`,
  );
  const match = source.match(re);
  if (!match) {
    throw new Error(`expected an exported function ${name} in ${filePath}, but none was found`);
  }
  return match[0];
}

/** Same extraction, for a private (unexported) helper like social/sync's runSync(). */
function extractFunction(source: string, name: string, filePath: string): string {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([\\s\\S]*?(?=\\nexport\\s+(?:async\\s+)?function\\s+\\w+\\s*\\(|$)`);
  const match = source.match(re);
  if (!match) {
    throw new Error(`expected a function ${name} in ${filePath}, but none was found`);
  }
  return match[0];
}

describe('SQLite-backed API routes have a safe unexpected-error boundary', () => {
  for (const entry of SQLITE_ROUTE_INVENTORY) {
    describe(entry.file, () => {
      const source = fs.readFileSync(path.join(ROOT, ...entry.file.split('/')), 'utf8');

      it('imports unexpectedError from lib/server/http', () => {
        expect(source).toMatch(/import\s+\{[^}]*\bunexpectedError\b[^}]*\}\s+from\s+'@\/lib\/server\/http'/);
      });

      if (entry.sharedHelper) {
        it(`its shared helper ${entry.sharedHelper}() calls unexpectedError(...)`, () => {
          const body = extractFunction(source, entry.sharedHelper as string, entry.file);
          expect(body).toMatch(/catch[\s\S]*unexpectedError\(/);
        });
      }

      for (const method of entry.methods) {
        it(`${method} has a catch boundary calling unexpectedError(...) (directly, or via ${entry.sharedHelper ?? 'its own try/catch'})`, () => {
          const body = extractExportedFunction(source, method, entry.file);
          if (entry.sharedHelper) {
            expect(body).toContain(`${entry.sharedHelper}(`);
          } else {
            expect(body).toMatch(/catch[\s\S]*unexpectedError\(/);
          }
        });
      }
    });
  }
});

/**
 * Representative executable coverage: mock the repository layer to throw
 * (never a real database), and prove the safe contract end to end for one
 * collection GET, one dynamic-param GET, one mutation, and one structurally
 * different nested + dynamic route. No real agent, connector, database, or
 * network call is ever invoked here — tests/setup.ts's global auth mock
 * already resolves every requireInternalUserOrResponse() call as an
 * internal user with no network/DB hit of its own.
 */
const SECRET_DETAIL = 'sqlite3: unable to open database file at /var/secret/founder-os.db';

async function assertSafe500(res: Response) {
  expect(res.status).toBe(500);
  expect(res.headers.get('content-type')).toMatch(/application\/json/);
  const body = await res.json();
  expect(body).toEqual({ error: 'internal server error' });
  const serialized = JSON.stringify(body);
  expect(serialized).not.toContain(SECRET_DETAIL);
  expect(serialized).not.toContain('/var/secret');
  expect(serialized).not.toMatch(/[/\\]/); // no path-shaped content of any kind
}

describe('representative executable coverage — repository throws', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/data');
    vi.resetModules();
  });

  it('collection GET (GET /api/agents) — getDb() throws', async () => {
    vi.doMock('@/lib/data', () => ({
      getDb: () => {
        throw new Error(SECRET_DETAIL);
      },
    }));
    const { GET } = await import('@/app/api/agents/route');
    await assertSafe500(await GET());
  });

  it('dynamic [platform] GET (GET /api/social/[platform]) — getDb() throws', async () => {
    vi.doMock('@/lib/data', () => ({
      getDb: () => {
        throw new Error(SECRET_DETAIL);
      },
    }));
    const { GET } = await import('@/app/api/social/[platform]/route');
    const res = await GET(new Request('http://x/api/social/instagram'), { params: { platform: 'instagram' } });
    await assertSafe500(res);
  });

  it('mutation (POST /api/lead-magnets) — getDb() throws after validation passes', async () => {
    vi.doMock('@/lib/data', () => ({
      getDb: () => {
        throw new Error(SECRET_DETAIL);
      },
    }));
    const { POST } = await import('@/app/api/lead-magnets/route');
    const res = await POST(
      new Request('http://x/api/lead-magnets', {
        method: 'POST',
        body: JSON.stringify({ name: 'Test Magnet', url: 'https://example.com/x' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    await assertSafe500(res);
  });

  it('nested + dynamic route (PATCH /api/lead-magnets/[id]) — getDb() throws', async () => {
    vi.doMock('@/lib/data', () => ({
      getDb: () => {
        throw new Error(SECRET_DETAIL);
      },
    }));
    const { PATCH } = await import('@/app/api/lead-magnets/[id]/route');
    const res = await PATCH(
      new Request('http://x/api/lead-magnets/some-id', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: { id: 'some-id' } },
    );
    await assertSafe500(res);
  });

  it('a downstream repo method throwing (not just getDb() itself) is equally safe — GET /api/departments', async () => {
    vi.doMock('@/lib/data', () => ({
      getDb: () => ({
        departments: {
          all: () => {
            throw new Error(SECRET_DETAIL);
          },
        },
      }),
    }));
    const { GET } = await import('@/app/api/departments/route');
    await assertSafe500(await GET());
  });

  it('intentional 400 responses are unaffected by the new boundary — POST /api/lead-magnets with an invalid body', async () => {
    // No getDb() mock needed: validation fails before any DB call, exactly
    // as before this pass.
    const { POST } = await import('@/app/api/lead-magnets/route');
    const res = await POST(
      new Request('http://x/api/lead-magnets', {
        method: 'POST',
        body: JSON.stringify({ name: '' }), // fails CreateSchema
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('intentional 404 responses are unaffected — PATCH /api/lead-magnets/[id] for a genuinely missing id', async () => {
    vi.doMock('@/lib/data', () => ({
      getDb: () => ({
        leadMagnets: { byId: () => null },
      }),
    }));
    const { PATCH } = await import('@/app/api/lead-magnets/[id]/route');
    const res = await PATCH(
      new Request('http://x/api/lead-magnets/missing', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: { id: 'missing' } },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'lead magnet not found' });
  });
});

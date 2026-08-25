import { beforeAll, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ClientsProvider } from '@/components/ClientsProvider';

// /login is the first page that reads next/headers's cookies() (via its own
// requireInternalUser() call, to redirect an already-authenticated internal
// visitor to /) — which only works inside a real Next.js request context,
// not a plain direct function call the way this file invokes every other
// server page. An empty cookie jar is enough: it makes getSupabaseUser()
// resolve to "no session" (no network call — there's no token to validate),
// so requireInternalUser() throws AuthError(401), /login's own catch treats
// that as "not already logged in", and it renders the form — exactly like a
// real first visit. Every other page in this file is unaffected — none of
// them import next/headers.
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], get: () => undefined, set: () => {} }),
}));
// /login calls requireInternalUser() in its own page body — defeat the
// global "always internal" test default (tests/setup.ts) so it exercises
// its real, unauthenticated behavior here (an empty cookie jar, per the
// mock above), matching how it's actually first visited. No other page in
// this file calls it — role enforcement for the rest lives in
// app/(internal)/layout.tsx, which this file never invokes (it calls each
// page's own default export directly, not through Next's real layout
// composition).
vi.unmock('@/lib/server/auth');

// Pages read the DB path at first access, so point it at a fresh seeded temp DB
// before any page module is imported. FUNNEL_PROVIDER keeps /funnel off the
// live Attio API in tests.
beforeAll(() => {
  process.env.FOUNDER_OS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'founder-os-smoke-')), 'test.db');
  process.env.FUNNEL_PROVIDER = 'seed';
  process.env.GBRAIN_BIN = path.join(tmpdir(), 'founder-os-no-gbrain-cli');
  // /login only — getSupabaseServerClient() validates these are set before
  // it ever reaches next/headers; dummy, network-unreachable values are
  // fine since the mocked empty cookie jar above never triggers a real
  // Auth call.
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://smoke-test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'smoke-test-publishable-key';
});

type PageEntry = {
  file: string; // path relative to app/, the source of truth for coverage
  // props is `any` so strongly-typed page components (e.g. /org's searchParams)
  // remain assignable to this generic invoker.
  load: () => Promise<{ default: (props?: any) => unknown }>;
  props?: unknown;
  /** 'use client' pages that call hooks directly (useState/useEffect/
   * useRouter) can't be invoked as a plain function — React's dispatcher
   * only exists inside an actual render. These render through React instead
   * of the direct-call trick server/wrapper pages use below. */
  client?: boolean;
};

// A minimal, inert router so `useRouter()` (only called by
// ClientDetailPage's delete flow) doesn't throw for lack of a provider.
const mockRouter = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
};

// Every app/**/page.tsx, with the props each needs to be invoked. `file`
// stays a clean, URL-meaningful relative path (no route-group segment) —
// discoverPages() below strips (group) segments to match, since a route
// group is invisible to Next's own routing and should be invisible here
// too. `load`'s import path is the real on-disk location and DOES include
// the (internal)/(auth) segment — Session Refresh + Internal Route
// Protection V1 moved every page below under app/(internal)/ or
// app/(auth)/login, so /login stops mounting the internal shell/data-
// fetching providers by construction (see app/layout.tsx /
// app/(internal)/layout.tsx). Note: this test invokes each page's default
// export directly — it does not render through Next's real layout
// composition, so app/(internal)/layout.tsx's requireInternalUser() check
// is never exercised here (nor was any auth check before this milestone) —
// that's covered by the dedicated internal-layout tests instead. The
// temporary /me diagnostic page (First Internal User + Login V1) has been
// removed now that manual QA proved real protection works end to end — its
// entry is gone from this list, not just its coverage.
const PAGES: PageEntry[] = [
  { file: 'page.tsx', load: () => import('@/app/(internal)/page'), client: true },
  { file: 'comms/page.tsx', load: () => import('@/app/(internal)/comms/page') },
  { file: 'social/page.tsx', load: () => import('@/app/(internal)/social/page') },
  { file: 'social/[platform]/page.tsx', load: () => import('@/app/(internal)/social/[platform]/page'), props: { params: { platform: 'instagram' } } },
  { file: 'social/beehiiv/page.tsx', load: () => import('@/app/(internal)/social/beehiiv/page') },
  { file: 'content/page.tsx', load: () => import('@/app/(internal)/content/page') },
  { file: 'content/lead-magnets/page.tsx', load: () => import('@/app/(internal)/content/lead-magnets/page') },
  { file: 'agents/page.tsx', load: () => import('@/app/(internal)/agents/page') },
  { file: 'tasks/page.tsx', load: () => import('@/app/(internal)/tasks/page') },
  { file: 'skills/page.tsx', load: () => import('@/app/(internal)/skills/page') },
  { file: 'org/page.tsx', load: () => import('@/app/(internal)/org/page'), props: { searchParams: {} } },
  { file: 'brain/page.tsx', load: () => import('@/app/(internal)/brain/page') },
  { file: 'brain/legacy/page.tsx', load: () => import('@/app/(internal)/brain/legacy/page') },
  { file: 'finances/page.tsx', load: () => import('@/app/(internal)/finances/page') },
  { file: 'funnel/page.tsx', load: () => import('@/app/(internal)/funnel/page'), props: { searchParams: {} } },
  { file: 'workflows/page.tsx', load: () => import('@/app/(internal)/workflows/page') },
  { file: 'integrations/page.tsx', load: () => import('@/app/(internal)/integrations/page') },
  { file: 'roadmap/page.tsx', load: () => import('@/app/(internal)/roadmap/page') },
  { file: 'analytics/page.tsx', load: () => import('@/app/(internal)/analytics/page') },
  { file: 'reference/page.tsx', load: () => import('@/app/(internal)/reference/page') },
  { file: 'personas/page.tsx', load: () => import('@/app/(internal)/personas/page') },
  // REKREATIVE pages (2026-08-20 QA pass — these were missing from the net entirely).
  { file: 'clients/page.tsx', load: () => import('@/app/(internal)/clients/page'), client: true },
  { file: 'clients/[clientId]/page.tsx', load: () => import('@/app/(internal)/clients/[clientId]/page'), props: { params: { clientId: 'client-acme' } }, client: true },
  { file: 'clients/[clientId]/results/page.tsx', load: () => import('@/app/(internal)/clients/[clientId]/results/page'), props: { params: { clientId: 'client-acme' } } },
  { file: 'leads/page.tsx', load: () => import('@/app/(internal)/leads/page'), client: true },
  { file: 'meta-ads/page.tsx', load: () => import('@/app/(internal)/meta-ads/page'), client: true },
  { file: 'automations/page.tsx', load: () => import('@/app/(internal)/automations/page') },
  { file: 'ai-agents/page.tsx', load: () => import('@/app/(internal)/ai-agents/page') },
  { file: 'connections/page.tsx', load: () => import('@/app/(internal)/connections/page') },
  { file: 'results/page.tsx', load: () => import('@/app/(internal)/results/page') },
  // First Internal User + Login V1.
  { file: 'login/page.tsx', load: () => import('@/app/(auth)/login/page') },
];

// Route-group segments — (internal), (auth) — are invisible to Next's own
// routing (stripped from the URL); this walk strips them too, so the
// discovered set matches PAGES' clean `file` labels instead of leaking the
// on-disk folder-organization detail into every test name.
function discoverPages(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const isRouteGroup = /^\(.*\)$/.test(entry.name);
    const rel = isRouteGroup ? base : base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...discoverPages(path.join(dir, entry.name), rel));
    else if (entry.name === 'page.tsx') out.push(rel);
  }
  return out;
}

describe('platform smoke — every page renders without throwing', () => {
  // 20s: pages that shell out to the gbrain CLI or distill the brain-store
  // (/brain) legitimately exceed vitest's 5s default under a loaded
  // parallel suite — this is a does-it-throw net, not a performance gate.
  test.each(PAGES)('$file renders', async ({ load, props, client }) => {
    const mod = await load();
    const Page = mod.default;
    if (client) {
      // 'use client' pages call hooks directly, so they need React's real
      // dispatcher — renderToStaticMarkup gives every child component one
      // without needing jsdom (useEffect simply never fires, same as any
      // other SSR pass — so ClientsProvider's own fetch never actually runs
      // here, same as app/layout.tsx wrapping every real page). A mock
      // AppRouterContext covers the one hook (useRouter, in
      // ClientDetailPage) that would otherwise throw for lack of a
      // provider; next/link degrades gracefully without one.
      expect(() =>
        renderToStaticMarkup(
          createElement(
            ClientsProvider,
            null,
            createElement(AppRouterContext.Provider, { value: mockRouter as any }, createElement(Page as any, props as any)),
          ),
        ),
      ).not.toThrow();
    } else {
      // Server components run their body (DB reads, data fetch) when invoked;
      // a throw here is exactly the failure we want to catch.
      await expect(Promise.resolve(Page(props))).resolves.toBeTruthy();
    }
  }, 20_000);

  test('the smoke net covers every app/**/page.tsx (no page escapes)', () => {
    const discovered = discoverPages(path.join(process.cwd(), 'app')).sort();
    const covered = PAGES.map((p) => p.file).sort();
    expect(covered).toEqual(discovered);
  });
});

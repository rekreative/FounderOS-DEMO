import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REKREATIVE_PRIMARY, NAV_ORDER, DIGIT_VIEWS, NAV_SYSTEM } from '@/lib/nav';

// Legacy FounderOS routes that must never be reachable from the global
// command palette or digit shortcuts — a stray keystroke or search must
// never drop the operator into old branding/seed data (2026-08-20 nav fix).
const LEGACY_FOUNDEROS_ROUTES = [
  '/agents',
  '/org',
  '/integrations',
  '/tasks',
  '/skills',
  '/workflows',
  '/comms',
  '/funnel',
  '/social',
  '/roadmap',
  '/reference',
  '/personas',
];

describe('shared nav config', () => {
  test('NAV_ORDER mirrors REKREATIVE_PRIMARY — the single navigation source of truth', () => {
    expect(NAV_ORDER).toEqual(REKREATIVE_PRIMARY.map((n) => n.href));
  });

  test('REKREATIVE_PRIMARY holds only REKREATIVE routes, in the sidebar order, in Spanish', () => {
    expect(REKREATIVE_PRIMARY.map((n) => n.href)).toEqual([
      '/',
      '/business',
      '/clients',
      '/leads',
      '/meta-ads',
      '/results',
      '/automations',
      '/ai-agents',
      '/connections',
      '/content',
      '/finances',
      '/brain',
      '/analytics',
    ]);
    for (const item of REKREATIVE_PRIMARY) {
      expect(LEGACY_FOUNDEROS_ROUTES).not.toContain(item.href);
    }
  });

  test('"/integrations" (retired legacy marketplace, now a redirect to /connections) is not discoverable in any nav collection', () => {
    // Visual QA correction, 2026-08-28: superseded the earlier "keep it
    // read-only" decision — the route itself still exists (as a redirect),
    // but must not be independently linkable from anywhere in the app.
    expect(NAV_SYSTEM.map((n) => n.href)).not.toContain('/integrations');
    expect(REKREATIVE_PRIMARY.map((n) => n.href)).not.toContain('/integrations');
  });

  test('the canonical "Integraciones" entry still points at /connections', () => {
    const connections = REKREATIVE_PRIMARY.find((n) => n.label === 'Integraciones');
    expect(connections?.href).toBe('/connections');
  });

  test('digit shortcuts (1–9) map to the first 9 REKREATIVE views in visible order', () => {
    expect(DIGIT_VIEWS).toEqual(NAV_ORDER.slice(0, 9));
    expect(DIGIT_VIEWS).toHaveLength(9);
  });

  test('digit shortcuts never reach a legacy FounderOS route', () => {
    for (const href of LEGACY_FOUNDEROS_ROUTES) {
      expect(DIGIT_VIEWS, `${href} must not be digit-reachable`).not.toContain(href);
    }
  });

  test('every digit target is a real page route', () => {
    // Session Refresh + Internal Route Protection V1 moved every internal
    // page under app/(internal)/ — a route group, invisible to the URLs
    // this test checks, but real on disk.
    for (const href of DIGIT_VIEWS) {
      const rel = href === '/' ? 'app/(internal)/page.tsx' : `app/(internal)/${href.replace(/^\//, '')}/page.tsx`;
      expect(existsSync(path.join(process.cwd(), rel)), `${href} should have a page.tsx`).toBe(true);
    }
  });

  test('CommandPalette consumes the shared DIGIT_VIEWS (no private stale copy)', () => {
    const src = readFileSync(path.join(process.cwd(), 'components', 'CommandPalette.tsx'), 'utf8');
    expect(src).toMatch(/from '@\/lib\/nav'/);
    expect(src).not.toMatch(/const DIGIT_VIEWS\s*=/); // must import, not redefine
  });

  test('the command palette source builds its nav commands from REKREATIVE_PRIMARY, not a private list', () => {
    // Moved from app/layout.tsx into app/(internal)/layout.tsx — the root
    // layout is now bare (no CommandPalette, no internal-shell providers);
    // see the Session Refresh + Internal Route Protection V1 milestone.
    const src = readFileSync(path.join(process.cwd(), 'app', '(internal)', 'layout.tsx'), 'utf8');
    expect(src).toMatch(/REKREATIVE_PRIMARY/);
    for (const href of LEGACY_FOUNDEROS_ROUTES) {
      expect(src, `${href} must not be a hard-coded command href`).not.toMatch(new RegExp(`href: '${href}'`));
    }
  });
});

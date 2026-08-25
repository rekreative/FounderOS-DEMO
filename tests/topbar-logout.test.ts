import { createElement } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The real logout control (Topbar, via components/LogoutButton.tsx) now
 * that the temporary /me page is gone. This test environment has no jsdom
 * (vitest.config.ts's `environment: 'node'`, same as every other test in
 * this suite) — renderToStaticMarkup can prove the component tree mounts
 * without throwing and that the accessible logout control is genuinely
 * present in the rendered shell, but it cannot simulate a click and observe
 * the resulting async signOut()/redirect (that needs a real DOM/hydration,
 * which this suite doesn't use anywhere, including for LoginForm — the
 * click → signOut → redirect flow remains manual-QA territory here, same
 * as it always has been for the login form).
 *
 * Topbar calls usePathname() and LogoutButton calls useRouter() — both
 * mocked directly here rather than via AppRouterContext.Provider, since
 * usePathname() has no value outside a real Next.js router context and
 * throws on the first .split() call otherwise.
 */
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

describe('Topbar logout control', () => {
  it('Topbar renders with the logout control present, without throwing', async () => {
    const { Topbar } = await import('@/components/Topbar');

    let markup = '';
    expect(() => {
      markup = renderToStaticMarkup(createElement(Topbar));
    }).not.toThrow();

    expect(markup).toContain('aria-label="Log out"');
  });

  it('LogoutButton\'s source calls the real signOut(), then router.push(\'/login\') + router.refresh() only on success — never on error', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'components', 'LogoutButton.tsx'), 'utf8');

    expect(source).toMatch(/getSupabaseBrowserClient\(\)/);
    expect(source).toMatch(/\.auth\.signOut\(\)/);
    expect(source).toMatch(/router\.push\('\/login'\)/);
    expect(source).toMatch(/router\.refresh\(\)/);
    // The error branch must return before reaching push/refresh — a
    // structural proxy for "never claims success on failure", checked here
    // rather than at runtime for the reason in the module comment above.
    expect(source).toMatch(/if \(error\) return/);
  });
});

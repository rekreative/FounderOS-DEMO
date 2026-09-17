import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A successful login must land on / (the real, now-protected home page),
 * not the removed temporary /me diagnostic page. No jsdom in this suite
 * (vitest.config.ts's `environment: 'node'`) means an actual form-submit →
 * signInWithPassword → redirect interaction can't be simulated here — same
 * constraint as tests/topbar-logout.test.ts, and the login form has never
 * had an automated interaction test in this codebase; this is a structural
 * proxy, and the real click-through is manual-QA territory.
 */
describe('LoginForm redirect target', () => {
  it('redirects to the role-safe portal on successful sign-in, never /me', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app', '(auth)', 'login', 'LoginForm.tsx'), 'utf8');

    expect(source).toMatch(/router\.push\('\/portal'\)/);
    expect(source).not.toMatch(/router\.push\('\/me'\)/);
    expect(source).toMatch(/router\.refresh\(\)/);
  });

  it('an already-authenticated visitor to /login is routed by its server-side role', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app', '(auth)', 'login', 'page.tsx'), 'utf8');

    expect(source).toMatch(/user\.role === 'internal' \? '\/' : '\/portal'/);
    expect(source).not.toMatch(/redirect\('\/me'\)/);
  });
});

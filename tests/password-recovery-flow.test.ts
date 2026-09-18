import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

describe('password recovery landing flow', () => {
  it('moves an authenticated Supabase recovery session from the public login landing page to set-password', () => {
    const source = fs.readFileSync(path.join(root, 'app', '(auth)', 'login', 'LoginForm.tsx'), 'utf8');

    expect(source).toMatch(/onAuthStateChange/);
    expect(source).toMatch(/PASSWORD_RECOVERY/);
    expect(source).toMatch(/router\.replace\('\/set-password'\)/);
  });

  it('keeps the password screen public while a recovery session finishes setup', () => {
    const source = fs.readFileSync(path.join(root, 'middleware.ts'), 'utf8');

    expect(source).toMatch(/'\/set-password'/);
  });
});

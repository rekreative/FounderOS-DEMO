import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  // Pages/components use the automatic JSX runtime (no `import React`), same as
  // Next builds them — without this, importing a *.tsx page throws
  // "React is not defined" under the classic runtime.
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Hermetic creds: .env.local is a live credential store read fresh at call
    // time (lib/creds.ts), so tests must never see Alex's real file. Tests
    // that exercise the store point this at their own tmp path.
    env: {
      FOUNDER_OS_ENV_LOCAL: path.resolve(__dirname, 'tests', '.env.local.does-not-exist'),
    },
    // Global default identity: most existing tests call an API/repo function
    // directly and were never about auth — Session Refresh + Internal Route
    // Protection V1 wired requireInternalUserOrResponse() into ~51 routes,
    // which would otherwise 401 every one of those pre-existing calls. This
    // file mocks lib/server/auth.ts to resolve as an internal user by
    // default; tests that specifically exercise the auth boundary itself
    // (tests/auth.test.ts, tests/api-auth.test.ts, tests/internal-layout.test.ts,
    // tests/api-internal-protection.test.ts, tests/audit-tenant-isolation.test.ts)
    // call vi.unmock('@/lib/server/auth') or declare their own vi.mock for
    // the same path, which cleanly overrides this default for that file only.
    setupFiles: [path.resolve(__dirname, 'tests', 'setup.ts')],
  },
});

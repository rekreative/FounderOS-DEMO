import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { verifyStandaloneTracing } from '../scripts/verify-standalone-tracing.js';

/**
 * Regression guard for the temporal-polyfill MODULE_NOT_FOUND crash: Next's
 * output-file-tracing for `output: 'standalone'` missed part of
 * node-ical's transitive temporal-polyfill dependency, which only fails at
 * runtime in production — `next build` succeeds either way, so nothing in
 * the normal test/typecheck/build pipeline caught it. This checks the real
 * build output, not next.config.mjs's text, so it stays correct even if the
 * fix's mechanism changes.
 *
 * Requires a prior `npm run build` (or `NEXT_DIST_DIR=... npm run build`) —
 * skips with a clear reason when no build output exists yet, which is the
 * normal case for a plain `npm test` run.
 */
const distDir = path.join(process.cwd(), process.env.NEXT_DIST_DIR || '.next');
const result = verifyStandaloneTracing(distDir);

describe('standalone output — temporal-polyfill tracing', () => {
  it.skipIf(!result.built)(
    'copies the full temporal-polyfill package (index.js and index.cjs) into standalone node_modules',
    () => {
      expect(result.problems).toEqual([]);
      expect(result.ok).toBe(true);
    },
  );
});

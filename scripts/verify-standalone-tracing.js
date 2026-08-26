// Verifies that Next.js's `output: 'standalone'` file tracing actually
// copied the full temporal-polyfill package tree into the standalone
// node_modules. node-ical (a direct dependency, externalized via
// serverComponentsExternalPackages in next.config.mjs) requires
// temporal-polyfill at runtime; temporal-polyfill is a dual ESM/CJS package
// whose entry file (index.js vs index.cjs) is picked by Node's require()
// resolution order, which differs across Node majors — the tracer has been
// observed to miss part of this tree, producing a MODULE_NOT_FOUND crash in
// production that never surfaces at build time. See next.config.mjs's
// outputFileTracingIncludes for the fix; this script is the regression
// guard confirming it actually worked for a given build.
//
// Usable standalone (`node scripts/verify-standalone-tracing.js`, e.g. as a
// post-build CI/deploy step) and importable from tests/standalone-tracing.test.ts.
const fs = require('fs');
const path = require('path');

function verifyStandaloneTracing(distDir) {
  const standaloneNodeModules = path.join(distDir, 'standalone', 'node_modules');
  const problems = [];

  if (!fs.existsSync(standaloneNodeModules)) {
    return { built: false, ok: false, problems: [`${standaloneNodeModules} does not exist — run "npm run build" first.`] };
  }

  for (const file of ['index.js', 'index.cjs']) {
    const full = path.join(standaloneNodeModules, 'temporal-polyfill', file);
    if (!fs.existsSync(full)) problems.push(`missing ${full}`);
  }

  const nodeIcalMain = path.join(standaloneNodeModules, 'node-ical', 'node-ical.js');
  if (!fs.existsSync(nodeIcalMain)) problems.push(`missing ${nodeIcalMain}`);

  return { built: true, ok: problems.length === 0, problems };
}

if (require.main === module) {
  const distDir = process.env.NEXT_DIST_DIR || '.next';
  const result = verifyStandaloneTracing(distDir);
  if (!result.built) {
    console.error(result.problems[0]);
    process.exit(1);
  }
  if (!result.ok) {
    console.error('Standalone tracing regression detected:');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log('Standalone tracing OK: temporal-polyfill and node-ical are fully present.');
}

module.exports = { verifyStandaloneTracing };

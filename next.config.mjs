/** @type {import('next').NextConfig} */
const nextConfig = {
  // Isolate the build output dir via env so a production build can run on its
  // own port without clobbering a concurrent `next dev` (which keeps `.next`).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Self-hosted deployment target (Railway): produces <distDir>/standalone
  // with a minimal server.js + traced node_modules for a long-running Node
  // process. See scripts/start-standalone.js for the launch step.
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'node-ical', 'nodemailer'],
    // node-ical (externalized above) pulls in temporal-polyfill, a dual
    // ESM/CJS package whose runtime-picked entry file (index.js vs
    // index.cjs) depends on the Node major version's require() resolution
    // order — output-file-tracing's static analysis has been observed to
    // miss part of that package's tree, producing a MODULE_NOT_FOUND at
    // runtime for whichever entry file it didn't copy. Force the whole
    // package in explicitly rather than trust the trace. Standalone output
    // copies everything traced into one shared node_modules, so any one of
    // these route keys is enough — all three are listed because they're the
    // concrete server entry points that reach lib/connectors/gcal.ts (via
    // lib/connectors/index.ts): the /api/connections route, the /integrations
    // page that calls allConnectorStatuses() directly, and /comms, which
    // renders the calendar connector directly.
    outputFileTracingIncludes: {
      '/api/connections': ['./node_modules/temporal-polyfill/**/*'],
      '/integrations': ['./node_modules/temporal-polyfill/**/*'],
      '/comms': ['./node_modules/temporal-polyfill/**/*'],
    },
  },
};

export default nextConfig;

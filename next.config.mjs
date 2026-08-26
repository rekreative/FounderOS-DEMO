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
  },
};

export default nextConfig;

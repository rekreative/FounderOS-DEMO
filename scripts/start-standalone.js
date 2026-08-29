// Launches the Next.js `output: 'standalone'` production server.
//
// Next.js does not copy `public/` or `<distDir>/static` into the standalone
// output automatically (see Next.js docs on `output: 'standalone'`), so this
// copies both before starting `server.js`. `server.js` itself already reads
// `process.env.PORT` (default 3000) and `process.env.HOSTNAME` — no port is
// hardcoded here, so Railway's dynamically-injected PORT is honored.
//
// HOSTNAME is force-overridden to '0.0.0.0' below (Railway Binding V1):
// server.js does `process.env.HOSTNAME || '0.0.0.0'`, and container runtimes
// (Railway included) routinely auto-populate HOSTNAME with the container's
// own hostname/ID. Left unmodified, that ambient value silently replaces the
// safe wildcard default — the process still starts and logs "Ready", but
// binds to an interface Railway's healthcheck prober can't reach, so Railway
// marks it unhealthy and kills it. Forcing 0.0.0.0 here is what actually
// makes the process reachable.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { verifyInstallationBeforeStart } = require('./verify-installation');

const distDir = process.env.NEXT_DIST_DIR || '.next';
const standaloneDir = path.join(distDir, 'standalone');
const serverFile = path.join(standaloneDir, 'server.js');

async function main() {
  if (!fs.existsSync(serverFile)) {
    console.error(`Standalone server not found at ${serverFile}. Run "npm run build" first.`);
    process.exit(1);
  }

  // REKREOS Phase 2: when FOUNDER_OS_VERIFY_INSTALLATION=true, confirm the
  // SQLite and Postgres installation markers exist and match BEFORE
  // server.js is ever spawned - a mismatch means founder-os.db was
  // replaced or recreated, and the process must never come up against it.
  // Flag off (the default) is a no-op: verifyInstallationBeforeStart()
  // returns { ok: true, skipped: true } without touching SQLite or
  // Postgres, so local/dev/CI behavior here is unchanged.
  const verification = await verifyInstallationBeforeStart(process.env, process.cwd());
  if (!verification.ok) {
    console.error(`Installation verification failed: ${verification.reason}`);
    process.exit(1);
  }

  if (fs.existsSync('public')) {
    fs.cpSync('public', path.join(standaloneDir, 'public'), { recursive: true });
  }

  const staticDir = path.join(distDir, 'static');
  if (fs.existsSync(staticDir)) {
    fs.cpSync(staticDir, path.join(standaloneDir, distDir, 'static'), { recursive: true });
  }

  const child = spawn(process.execPath, [serverFile], {
    stdio: 'inherit',
    env: {
      ...process.env,
      HOSTNAME: '0.0.0.0',
    },
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch(() => {
  // Fixed, generic message only - main() can fail from many places (a
  // blocked static-file copy, a spawn failure, ...) and the underlying
  // error's own message can carry a filesystem path or other local detail.
  // Never print the underlying error itself here.
  console.error('start-standalone.js failed to start.');
  process.exit(1);
});

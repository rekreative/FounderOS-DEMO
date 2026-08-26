// Launches the Next.js `output: 'standalone'` production server.
//
// Next.js does not copy `public/` or `<distDir>/static` into the standalone
// output automatically (see Next.js docs on `output: 'standalone'`), so this
// copies both before starting `server.js`. `server.js` itself already reads
// `process.env.PORT` (default 3000) and `process.env.HOSTNAME` — no port is
// hardcoded here, so Railway's dynamically-injected PORT is honored.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const distDir = process.env.NEXT_DIST_DIR || '.next';
const standaloneDir = path.join(distDir, 'standalone');
const serverFile = path.join(standaloneDir, 'server.js');

if (!fs.existsSync(serverFile)) {
  console.error(`Standalone server not found at ${serverFile}. Run "npm run build" first.`);
  process.exit(1);
}

if (fs.existsSync('public')) {
  fs.cpSync('public', path.join(standaloneDir, 'public'), { recursive: true });
}

const staticDir = path.join(distDir, 'static');
if (fs.existsSync(staticDir)) {
  fs.cpSync(staticDir, path.join(standaloneDir, distDir, 'static'), { recursive: true });
}

const child = spawn(process.execPath, [serverFile], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 0));

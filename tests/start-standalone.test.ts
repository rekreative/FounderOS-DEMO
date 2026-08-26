import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * scripts/start-standalone.js spawns the Next.js standalone server.js.
 * server.js does `process.env.HOSTNAME || '0.0.0.0'` — container runtimes
 * (Railway included) routinely auto-populate HOSTNAME with the container's
 * own hostname/ID, which silently overrides that safe default and makes the
 * server bind to an interface Railway's healthcheck prober can't reach
 * (Railway Binding V1). This proves start-standalone.js force-overrides
 * HOSTNAME to '0.0.0.0' on the spawned child regardless of whatever ambient
 * HOSTNAME the container sets, while every other env var — PORT included —
 * passes through unchanged.
 *
 * Real black-box integration test rather than a module mock: vi.mock('fs')
 * / vi.mock('child_process') do not reliably intercept a plain CommonJS
 * script's own require() calls when it's loaded via dynamic import(), so
 * this instead runs scripts/start-standalone.js as a genuine child process
 * against a throwaway "standalone/server.js" stub that just dumps its own
 * env to stdout as JSON — the real spawn() call, the real env object, no
 * mocking gaps to worry about.
 */

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'start-standalone.js');

function runStartStandalone(env: Record<string, string>): NodeJS.ProcessEnv {
  const distDir = mkdtempSync(path.join(tmpdir(), 'start-standalone-'));
  const standaloneDir = path.join(distDir, 'standalone');
  mkdirSync(standaloneDir, { recursive: true });
  writeFileSync(path.join(standaloneDir, 'server.js'), 'process.stdout.write(JSON.stringify(process.env));\n');

  try {
    const result = spawnSync(process.execPath, [SCRIPT_PATH], {
      // cwd inside the empty tmp dir so the script's `fs.existsSync('public')`
      // check (relative to cwd) is false and the real repo's public/ folder
      // is never touched by this test.
      cwd: distDir,
      env: { ...process.env, ...env, NEXT_DIST_DIR: distDir },
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`start-standalone.js exited ${result.status}: ${result.stderr}`);
    }
    return JSON.parse(result.stdout);
  } finally {
    rmSync(distDir, { recursive: true, force: true });
  }
}

describe('scripts/start-standalone.js — Railway binding', () => {
  it('forces HOSTNAME to 0.0.0.0 even when the ambient environment sets a bad container hostname', () => {
    const env = runStartStandalone({ HOSTNAME: 'some-bad-container-id', PORT: '8080' });
    expect(env.HOSTNAME).toBe('0.0.0.0');
  });

  it('forces HOSTNAME to 0.0.0.0 even when no ambient HOSTNAME is set at all', () => {
    const env = runStartStandalone({ PORT: '3000' });
    expect(env.HOSTNAME).toBe('0.0.0.0');
  });

  it('preserves the Railway-injected PORT unchanged', () => {
    const env = runStartStandalone({ PORT: '4173', HOSTNAME: 'whatever-the-container-set' });
    expect(env.PORT).toBe('4173');
  });

  it('preserves every other existing environment variable untouched', () => {
    const env = runStartStandalone({
      DATABASE_URL: 'postgres://example-not-real/db',
      SOME_UNRELATED_VAR: 'keep-me',
    });
    expect(env.DATABASE_URL).toBe('postgres://example-not-real/db');
    expect(env.SOME_UNRELATED_VAR).toBe('keep-me');
  });
});

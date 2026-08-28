import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { parseEnvFile, extractMcpEnvKey, readEnvLocal, resolveCred, runtimeEnv } from '@/lib/creds';

describe('parseEnvFile', () => {
  test('parses KEY=value lines and ignores comments and blanks', () => {
    const content = [
      '# Zernio',
      'ZERNIO_API_KEY=zk_live_abc123',
      '',
      'export MIRO_ACCESS_TOKEN=mt-456',
      'EMPTY=',
      'QUOTED="with spaces"',
      "SINGLE='single'",
    ].join('\n');
    const parsed = parseEnvFile(content);
    expect(parsed.ZERNIO_API_KEY).toBe('zk_live_abc123');
    expect(parsed.MIRO_ACCESS_TOKEN).toBe('mt-456');
    expect(parsed.EMPTY).toBe('');
    expect(parsed.QUOTED).toBe('with spaces');
    expect(parsed.SINGLE).toBe('single');
    expect(Object.keys(parsed)).not.toContain('# Zernio');
  });

  test('keeps = signs inside values', () => {
    expect(parseEnvFile('AUTH=Basic dXNlcjpwYXNz==').AUTH).toBe('Basic dXNlcjpwYXNz==');
  });
});

describe('extractMcpEnvKey', () => {
  test('pulls an env value out of a claude.json mcpServers entry', () => {
    const claudeJson = {
      mcpServers: {
        attio: { command: 'npx', args: ['attio-mcp'], env: { ATTIO_API_KEY: 'att_secret' } },
      },
    };
    expect(extractMcpEnvKey(claudeJson, 'attio', 'ATTIO_API_KEY')).toBe('att_secret');
  });

  test('returns undefined when the server or key is missing', () => {
    expect(extractMcpEnvKey({}, 'attio', 'ATTIO_API_KEY')).toBeUndefined();
    expect(extractMcpEnvKey({ mcpServers: { attio: {} } }, 'attio', 'ATTIO_API_KEY')).toBeUndefined();
  });
});

// Legacy secret-write shutdown (Connections/Secrets V1): .env.local is
// read-only from this app's own runtime — no upsertEnvLocal/removeEnvLocal
// exists anymore, and nothing here ever writes to the file. These tests
// exercise the read-only surface (readEnvLocal/resolveCred/runtimeEnv)
// against a file written directly via fs, standing in for a human editing
// .env.local by hand in local development.
describe('env.local as a read-only credential source (local development)', () => {
  let tmp: string;
  const prevOverride = process.env.FOUNDER_OS_ENV_LOCAL;

  beforeEach(() => {
    tmp = path.join(os.tmpdir(), `alex-env-local-${process.pid}-${Math.random().toString(36).slice(2)}`);
    process.env.FOUNDER_OS_ENV_LOCAL = tmp;
  });
  afterEach(() => {
    if (prevOverride === undefined) delete process.env.FOUNDER_OS_ENV_LOCAL;
    else process.env.FOUNDER_OS_ENV_LOCAL = prevOverride;
    try { fs.unlinkSync(tmp); } catch {}
  });

  test('readEnvLocal reads a hand-written file', () => {
    fs.writeFileSync(tmp, '# comment\nFOO_API_KEY=abc123\n');
    expect(readEnvLocal().FOO_API_KEY).toBe('abc123');
  });

  test('readEnvLocal returns {} when the file does not exist — never throws', () => {
    expect(readEnvLocal()).toEqual({});
  });

  test('resolveCred prefers a fresh env.local read over a stale process.env', () => {
    process.env.STALE_TEST_KEY = 'from-boot';
    fs.writeFileSync(tmp, 'STALE_TEST_KEY=from-file\n');
    expect(resolveCred('STALE_TEST_KEY', [])).toBe('from-file');
    delete process.env.STALE_TEST_KEY;
    expect(resolveCred('STALE_TEST_KEY', [])).toBe('from-file');
  });

  test('runtimeEnv overlays env.local onto process.env', () => {
    process.env.ONLY_PROCESS_KEY = 'proc';
    fs.writeFileSync(tmp, 'ONLY_FILE_KEY=file\n');
    const env = runtimeEnv();
    expect(env.ONLY_PROCESS_KEY).toBe('proc');
    expect(env.ONLY_FILE_KEY).toBe('file');
    delete process.env.ONLY_PROCESS_KEY;
  });
});

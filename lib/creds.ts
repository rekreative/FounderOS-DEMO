import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Credential resolution for connectors. Alex's keys already live in
 * canonical locations around the machine (~/.config/social/.env,
 * knowledge/.env.agents, ~/.config/mcp.json, project .env files). Connectors
 * resolve from process.env first, then fall back to those files at runtime —
 * no secrets are ever copied into this repo.
 */

export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const stripped = line.startsWith('export ') ? line.slice(7) : line;
    const eq = stripped.indexOf('=');
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function extractMcpEnvKey(claudeJson: unknown, server: string, key: string): string | undefined {
  const servers = (claudeJson as { mcpServers?: Record<string, { env?: Record<string, string> }> })
    ?.mcpServers;
  return servers?.[server]?.env?.[key];
}

const HOME = os.homedir();

export const CRED_FILES = {
  socialMedia: path.join(HOME, '.config/social', '.env'),
  agentsEnv: path.join(HOME, 'knowledge', '.env.agents'),
  arcads: path.join(HOME, 'Projects', 'arcads-agent-skills', '.env'),
  claudeJson: path.join(HOME, '.config/mcp.json'),
};

function readEnvFileSafe(filePath: string): Record<string, string> {
  try {
    return parseEnvFile(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/* ---- .env.local as a read-only live source (local development only) ----
 * Next only loads .env.local into process.env at boot; connectors that
 * resolve credentials at call time (resolveCred/runtimeEnv below) read the
 * file fresh instead, so a manually-edited value takes effect without a
 * restart. FOUNDER_OS_ENV_LOCAL overrides the path for tests.
 *
 * REKREOS does not write to this file from any request handler — Railway
 * Variables are the only production source of truth for secrets, and
 * .env.local is local-development-only. There is no browser-facing
 * secret-write path in this app (Legacy secret-write shutdown, Connections/
 * Secrets V1). */

export function envLocalPath(): string {
  return process.env.FOUNDER_OS_ENV_LOCAL ?? path.join(process.cwd(), '.env.local');
}

export function readEnvLocal(): Record<string, string> {
  return readEnvFileSafe(envLocalPath());
}

/** process.env with a fresh .env.local overlay — hand this to connectors that
 *  take an env record so a just-pasted key connects without a restart. */
export function runtimeEnv(): Record<string, string | undefined> {
  return { ...process.env, ...readEnvLocal() };
}

/** Fresh .env.local first, then process.env, then each env file in order. */
export function resolveCred(name: string, files: string[]): string | undefined {
  const fromLocal = readEnvLocal()[name];
  if (fromLocal) return fromLocal;
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;
  for (const file of files) {
    const value = readEnvFileSafe(file)[name];
    if (value) return value;
  }
  return undefined;
}

export function resolveAttioKey(): string | undefined {
  if (process.env.ATTIO_API_KEY) return process.env.ATTIO_API_KEY;
  try {
    const claudeJson = JSON.parse(fs.readFileSync(CRED_FILES.claudeJson, 'utf8'));
    return extractMcpEnvKey(claudeJson, 'attio', 'ATTIO_API_KEY');
  } catch {
    return undefined;
  }
}

/** ManyChat's key lives in ~/.config/mcp.json (the manychat MCP registration),
 *  same reuse pattern as Attio. .env.local / process.env still win. */
export function resolveManychatKey(): string | undefined {
  const direct = readEnvLocal().MANYCHAT_API_KEY ?? process.env.MANYCHAT_API_KEY;
  if (direct) return direct;
  try {
    const claudeJson = JSON.parse(fs.readFileSync(CRED_FILES.claudeJson, 'utf8'));
    return extractMcpEnvKey(claudeJson, 'manychat', 'MANYCHAT_API_KEY');
  } catch {
    return undefined;
  }
}

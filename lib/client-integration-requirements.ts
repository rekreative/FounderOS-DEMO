import { getClients } from '@/lib/clients';
import {
  getIntegrationConfigurationStatus,
  type IntegrationConnection,
  type IntegrationPlatform,
} from '@/lib/integration-connections';

// Client technical onboarding — a lightweight PLAN layered on top of the
// existing IntegrationConnection records, never a redesign of them. This
// module answers "which platforms should this client have, and are they
// required or optional" (the onboarding plan); lib/integration-connections.ts
// still answers "does an actual connection record exist, and what is its
// configuration/verification state" (the operational reality). One
// requirement may eventually be satisfied by one connection — matched by
// platform plus `connectionScope` (see below), because V1 assumes at most
// one connection per platform per client, and at most one shared internal
// connection per platform agency-wide. A future multi-account client (e.g.
// two WhatsApp numbers) or multiple internal accounts for the same platform
// would need a requirement to reference a connection by its stable id
// instead of matching by platform.

export const INTEGRATION_REQUIREMENT_LEVEL_OPTIONS = [
  { id: 'required', label: 'Requerida' },
  { id: 'optional', label: 'Opcional' },
] as const;
export type IntegrationRequirementLevel = (typeof INTEGRATION_REQUIREMENT_LEVEL_OPTIONS)[number]['id'];

/** Who owns the connection expected to satisfy this requirement:
 * 'client' — a connection scoped to this specific client (clientId +
 *   platform) is expected. Most platforms.
 * 'internal' — REKREATIVE's own shared connection for this platform
 *   (scope==='internal', any clientId) satisfies it. Shared agency
 *   infrastructure like Make or OpenAI — a client should never need a
 *   duplicate connection merely because the requirement belongs to their
 *   plan. */
export const INTEGRATION_REQUIREMENT_CONNECTION_SCOPE_OPTIONS = [
  { id: 'client', label: 'Cliente' },
  { id: 'internal', label: 'REKREATIVE Compartida' },
] as const;
export type IntegrationRequirementConnectionScope = (typeof INTEGRATION_REQUIREMENT_CONNECTION_SCOPE_OPTIONS)[number]['id'];

/** A requirement row's absence for a given (clientId, platform) pair means
 * "not used by this client" — there is no persisted 'unused' value. Toggling
 * a platform to "No usada" in the requirements editor removes its row via
 * setClientIntegrationRequirement(clientId, platform, null). */
export type ClientIntegrationRequirement = {
  id: string;
  clientId: string;
  platform: IntegrationPlatform;
  requirement: IntegrationRequirementLevel;
  connectionScope: IntegrationRequirementConnectionScope;
  createdAt: string;
  updatedAt: string;
};

/** Deterministic default connectionScope per platform — used both to seed
 * the demo template and, critically, as the safe migration fallback for any
 * requirement row persisted before connectionScope existed (see
 * normalizeRequirement below). Never changes an existing row's `requirement`
 * level or removes it; only backfills the new field. */
const DEFAULT_CONNECTION_SCOPE_BY_PLATFORM: Record<IntegrationPlatform, IntegrationRequirementConnectionScope> = {
  meta: 'client',
  instagram: 'client',
  whatsapp: 'client',
  make: 'internal',
  manychat: 'client',
  openai: 'internal',
  anthropic: 'internal',
  google_sheets: 'client',
  google_calendar: 'client',
  stripe: 'client',
  paypal: 'client',
  other: 'client',
};

const STORAGE_KEY = 'rek_client_integration_requirements_v1';

// ===== RAW STORAGE (kept private to this module) =====

function readStorage<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to parse ${key} from localStorage`, error);
    return [];
  }
}

function writeStorage<T>(key: string, value: T[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to write ${key} to localStorage`, error);
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

/** Safe read-time migration: a requirement row persisted before
 * connectionScope existed is missing the field entirely (JSON.parse yields
 * `undefined`). Backfilling it deterministically here — rather than
 * requiring a one-time rewrite pass — means existing customization
 * (requirement level, which platforms exist at all) is never touched or
 * lost; only the new field is filled in, the same way every time it's read. */
export function normalizeRequirement(raw: ClientIntegrationRequirement): ClientIntegrationRequirement {
  if (raw.connectionScope === 'client' || raw.connectionScope === 'internal') return raw;
  return { ...raw, connectionScope: DEFAULT_CONNECTION_SCOPE_BY_PLATFORM[raw.platform] ?? 'client' };
}

function readRequirements(): ClientIntegrationRequirement[] {
  return readStorage<ClientIntegrationRequirement>(STORAGE_KEY).map(normalizeRequirement);
}

// ===== DEFAULT ONBOARDING TEMPLATE =====
// A pragmatic default for a typical REKREATIVE lead-generation client — NOT
// a claim that every client needs every platform. Applied automatically,
// exactly once, to EVERY client — the three seeded demo clients from
// lib/clients.ts's SEED_CLIENTS on first load, and any client created later
// through /clients the next time initializeClientIntegrationRequirementsStoreIfNeeded()
// runs (see below). SEEDED_CLIENT_IDS below is only the node/no-window test
// fallback (getClients() is empty without a browser) — the real, general
// path never hardcodes client ids. A client's plan is free to diverge from
// this template afterward via the requirements editor
// (setClientIntegrationRequirement); that divergence is never reset.

const DEFAULT_REQUIRED_PLATFORMS: IntegrationPlatform[] = ['meta', 'whatsapp', 'make', 'openai', 'google_sheets'];
const DEFAULT_OPTIONAL_PLATFORMS: IntegrationPlatform[] = [
  'instagram',
  'manychat',
  'google_calendar',
  'stripe',
  'paypal',
  'anthropic',
];
const SEEDED_CLIENT_IDS = ['client-acme', 'client-northwind', 'client-lumen'];

/** The default template's rows for exactly one client — works for ANY
 * clientId, never a hardcoded list. Used both by the original demo seed
 * (server/no-window fallback, and the first-ever browser touch) and by the
 * per-client initialization that fixes new clients created later via
 * /clients (see computeRequirementInitialization below). */
export function seedDefaultRequirementsForClient(clientId: string): ClientIntegrationRequirement[] {
  const now = isoNow();
  const rows: ClientIntegrationRequirement[] = [];
  for (const platform of DEFAULT_REQUIRED_PLATFORMS) {
    rows.push({
      id: `req-${clientId}-${platform}`,
      clientId,
      platform,
      requirement: 'required',
      connectionScope: DEFAULT_CONNECTION_SCOPE_BY_PLATFORM[platform],
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const platform of DEFAULT_OPTIONAL_PLATFORMS) {
    rows.push({
      id: `req-${clientId}-${platform}`,
      clientId,
      platform,
      requirement: 'optional',
      connectionScope: DEFAULT_CONNECTION_SCOPE_BY_PLATFORM[platform],
      createdAt: now,
      updatedAt: now,
    });
  }
  return rows;
}

function seedDemoClientIntegrationRequirements(): ClientIntegrationRequirement[] {
  return SEEDED_CLIENT_IDS.flatMap((clientId) => seedDefaultRequirementsForClient(clientId));
}

/** Tracks which clientIds have already received the default template —
 * separate from the requirement rows themselves, because "this client has
 * zero rows" is genuinely ambiguous (never initialized vs. a user who
 * intentionally cleared every platform to "No usada"). Without this, a
 * client with zero rows would look identical to a brand-new one and get
 * silently re-seeded, which is exactly the customization-loss this module
 * must never cause. */
const INITIALIZED_STORAGE_KEY = 'rek_client_integration_requirements_initialized_v1';

/** Pure decision core: given whatever requirement rows and initialized-id
 * set already exist, plus the full current client id list, returns the rows
 * to add (and the updated initialized-id set) for any client not yet
 * initialized. No storage access — this is what keeps the safety rules
 * (idempotent, never overwrites customization, works for any client id,
 * never hardcodes one) directly testable without a browser. The one-time
 * migration case — a client with existing rows but no entry yet in the
 * initialized-id set (true for every client that existed before this
 * per-client tracking was introduced) — is marked initialized WITHOUT
 * touching their rows, so pre-existing customization survives untouched. */
export function computeRequirementInitialization(
  existingRows: ClientIntegrationRequirement[],
  initializedClientIds: string[],
  allClientIds: string[],
): { newRows: ClientIntegrationRequirement[]; initializedClientIds: string[] } {
  const initialized = new Set(initializedClientIds);
  const newRows: ClientIntegrationRequirement[] = [];

  for (const clientId of allClientIds) {
    if (initialized.has(clientId)) continue;

    const hasExistingRows = existingRows.some((row) => row.clientId === clientId);
    if (hasExistingRows) {
      initialized.add(clientId);
      continue;
    }

    newRows.push(...seedDefaultRequirementsForClient(clientId));
    initialized.add(clientId);
  }

  return { newRows, initializedClientIds: [...initialized] };
}

// ===== STORE INITIALIZATION =====

/** Runs on every mount of the Integrations board (see
 * components/IntegrationConnectionsBoard.tsx) — idempotent per client via
 * computeRequirementInitialization above, so it is exactly this call that
 * catches a client created later through /clients: the first time this
 * function runs after that client exists, it seeds their template once and
 * marks them initialized; every call after that is a no-op for them. */
export function initializeClientIntegrationRequirementsStoreIfNeeded(): ClientIntegrationRequirement[] {
  if (typeof window === 'undefined') {
    return seedDemoClientIntegrationRequirements();
  }

  const existingRows = readRequirements();
  const initializedClientIds = readStorage<string>(INITIALIZED_STORAGE_KEY);
  const allClientIds = getClients().map((client) => client.id);

  const { newRows, initializedClientIds: nextInitializedClientIds } = computeRequirementInitialization(
    existingRows,
    initializedClientIds,
    allClientIds,
  );

  if (newRows.length === 0) {
    return existingRows;
  }

  const merged = [...existingRows, ...newRows];
  writeStorage(STORAGE_KEY, merged);
  writeStorage(INITIALIZED_STORAGE_KEY, nextInitializedClientIds);
  return merged;
}

// ===== READ =====

export function getClientIntegrationRequirements(clientId?: string): ClientIntegrationRequirement[] {
  const rows = readRequirements();
  return !clientId ? rows : rows.filter((row) => row.clientId === clientId);
}

// ===== WRITE =====
// Single writer: setClientIntegrationRequirement. There is no separate
// "delete" function — passing requirement=null IS the removal path (a
// platform toggled to "No usada"), kept as one function rather than two to
// match this module's one-row-per-(clientId,platform) invariant explicitly.

export function setClientIntegrationRequirement(
  clientId: string,
  platform: IntegrationPlatform,
  requirement: IntegrationRequirementLevel | null,
): ClientIntegrationRequirement | null {
  if (!getClients().some((client) => client.id === clientId)) {
    throw new Error('Cannot set an integration requirement for a missing client id');
  }

  const rows = readRequirements();
  const index = rows.findIndex((row) => row.clientId === clientId && row.platform === platform);

  if (requirement === null) {
    if (index === -1) return null;
    rows.splice(index, 1);
    writeStorage(STORAGE_KEY, rows);
    return null;
  }

  const now = isoNow();
  if (index === -1) {
    const created: ClientIntegrationRequirement = {
      id: `req-${clientId}-${platform}-${Date.now().toString(36)}`,
      clientId,
      platform,
      requirement,
      connectionScope: DEFAULT_CONNECTION_SCOPE_BY_PLATFORM[platform] ?? 'client',
      createdAt: now,
      updatedAt: now,
    };
    rows.push(created);
    writeStorage(STORAGE_KEY, rows);
    return created;
  }

  // Preserve the existing row's connectionScope — toggling Requerida/Opcional
  // must never silently reassign who owns the underlying connection.
  const updated: ClientIntegrationRequirement = { ...rows[index], requirement, updatedAt: now };
  rows[index] = updated;
  writeStorage(STORAGE_KEY, rows);
  return updated;
}

// ===== DERIVED (never persisted) =====

export const REQUIREMENT_STATE_OPTIONS = [
  { id: 'pending', label: 'Pendiente' },
  { id: 'incomplete', label: 'Configuración incompleta' },
  { id: 'configured', label: 'Configurada' },
] as const;
export type RequirementConnectionState = (typeof REQUIREMENT_STATE_OPTIONS)[number]['id'];

export type ClientRequirementRow = {
  platform: IntegrationPlatform;
  requirement: IntegrationRequirementLevel;
  connectionScope: IntegrationRequirementConnectionScope;
  /** Matched per connectionScope — 'client' matches this requirement's own
   * clientId+platform; 'internal' matches ANY scope==='internal' connection
   * for that platform (REKREATIVE's shared infrastructure), regardless of
   * clientId. See the module-level comment on this matching assumption and
   * its future multi-account limitation. */
  connection: IntegrationConnection | null;
  state: RequirementConnectionState;
};

/** Bridges a client's requirement plan to actual connection records — the
 * fix for "a client shouldn't need a duplicate Make/OpenAI connection just
 * because it's on their plan": an 'internal' requirement is satisfied by
 * REKREATIVE's own shared connection, not a client-owned one. Pure — takes
 * pre-scoped arrays rather than reading storage, so it stays testable
 * without a browser. `connections` must include both this client's own
 * connections AND every internal connection (the caller is responsible for
 * assembling that set) so internal-scoped requirements have something to
 * match against. */
export function buildClientRequirementRows(
  requirements: ClientIntegrationRequirement[],
  connections: IntegrationConnection[],
): ClientRequirementRow[] {
  return requirements.map((requirementRow) => {
    const connection =
      connections.find((c) =>
        requirementRow.connectionScope === 'internal'
          ? c.scope === 'internal' && c.platform === requirementRow.platform
          : c.clientId === requirementRow.clientId && c.platform === requirementRow.platform,
      ) ?? null;
    const state: RequirementConnectionState = !connection
      ? 'pending'
      : getIntegrationConfigurationStatus(connection) === 'incomplete'
        ? 'incomplete'
        : 'configured';
    return {
      platform: requirementRow.platform,
      requirement: requirementRow.requirement,
      connectionScope: requirementRow.connectionScope,
      connection,
      state,
    };
  });
}

export type ClientOnboardingSummary = {
  clientId: string;
  requiredTotal: number;
  requiredConfigured: number;
  /** Required, no connection record at all. */
  requiredPending: number;
  /** Required, a connection exists but its configuration is incomplete. */
  requiredIncomplete: number;
  /** Connections actually matched to one of this client's requirement rows
   *  (client-owned or a shared internal one this client depends on, required
   *  or optional) with a manually-recorded incident. Deliberately scoped to
   *  matched rows only — an unrelated internal connection's incident must
   *  never bleed into every client's count just because it's internal. */
  incidents: number;
  /** Required-only, per the honesty rule below. Null when requiredTotal is 0
   *  — a client with zero required platforms has no percentage to show,
   *  never a fake 100%/0%. */
  progressPercent: number | null;
};

/** Technical onboarding progress — REQUIRED integrations only. Optional
 * integrations never move this number, and verificationStatus is
 * deliberately excluded: configuration and live verification stay separate
 * concepts everywhere else in this module (lib/integration-connections.ts),
 * and onboarding completion follows the same rule. `requirements` should be
 * scoped to this one client; `connections` must include this client's own
 * connections AND every internal connection (see buildClientRequirementRows)
 * so 'internal'-scope requirements (Make, OpenAI, ...) can be satisfied by
 * REKREATIVE's shared connection instead of demanding a client-owned duplicate. */
export function summarizeClientOnboarding(
  clientId: string,
  requirements: ClientIntegrationRequirement[],
  connections: IntegrationConnection[],
): ClientOnboardingSummary {
  const rows = buildClientRequirementRows(requirements, connections);
  const requiredRows = rows.filter((row) => row.requirement === 'required');
  const requiredTotal = requiredRows.length;
  const requiredConfigured = requiredRows.filter((row) => row.state === 'configured').length;
  const requiredPending = requiredRows.filter((row) => row.state === 'pending').length;
  const requiredIncomplete = requiredRows.filter((row) => row.state === 'incomplete').length;
  const incidents = rows.filter((row) => row.connection?.verificationStatus === 'failed').length;

  return {
    clientId,
    requiredTotal,
    requiredConfigured,
    requiredPending,
    requiredIncomplete,
    incidents,
    progressPercent: requiredTotal === 0 ? null : Math.round((requiredConfigured / requiredTotal) * 100),
  };
}

// ===== LABELS =====

export function getIntegrationRequirementLevelLabel(level: IntegrationRequirementLevel): string {
  return INTEGRATION_REQUIREMENT_LEVEL_OPTIONS.find((option) => option.id === level)?.label ?? level;
}

export function getRequirementConnectionScopeLabel(scope: IntegrationRequirementConnectionScope): string {
  return INTEGRATION_REQUIREMENT_CONNECTION_SCOPE_OPTIONS.find((option) => option.id === scope)?.label ?? scope;
}

/** "Pendiente" is reserved for a REQUIRED platform with no connection yet —
 * an OPTIONAL platform in the same raw `state` (no connection) reads as "No
 * añadida" instead, since nothing is actually missing/blocking. This is a
 * display-only distinction: the `state` itself (and the onboarding progress
 * math in summarizeClientOnboarding) never depends on requirement level —
 * only this label does. `requirement` defaults to 'required' so a bare
 * one-argument call keeps its prior meaning. */
export function getRequirementStateLabel(
  state: RequirementConnectionState,
  requirement: IntegrationRequirementLevel = 'required',
): string {
  if (state === 'pending' && requirement === 'optional') return 'No añadida';
  return REQUIREMENT_STATE_OPTIONS.find((option) => option.id === state)?.label ?? state;
}

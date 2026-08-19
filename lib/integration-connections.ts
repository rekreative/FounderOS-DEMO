import { getClients } from '@/lib/clients';

// Integrations / Connection Health V1 — a management layer over WHICH
// external tools REKREATIVE and its clients use, NOT a live connector. This
// module never calls an external API and never derives status from a real
// check — same honesty rule as lib/automations.ts's AutomationDataSource and
// lib/agents-ai.ts's AiAgentDataSource, and deliberately isolated from
// FounderOS's real lib/connectors/* + app/integrations (machine-bound,
// secret-writing infrastructure this module must never touch or resemble).

export const INTEGRATION_SCOPE_OPTIONS = [
  { id: 'client', label: 'Cliente' },
  { id: 'internal', label: 'Interno' },
] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPE_OPTIONS)[number]['id'];

export const INTEGRATION_PLATFORM_OPTIONS = [
  { id: 'meta', label: 'Meta' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'make', label: 'Make' },
  { id: 'manychat', label: 'ManyChat' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google_sheets', label: 'Google Sheets' },
  { id: 'google_calendar', label: 'Google Calendar' },
  { id: 'stripe', label: 'Stripe' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'other', label: 'Otro' },
] as const;
export type IntegrationPlatform = (typeof INTEGRATION_PLATFORM_OPTIONS)[number]['id'];

// ── Configuration status — always derived, never persisted (see
// getIntegrationConfigurationStatus). Same discipline as
// lib/automations.ts's AutomationStatus/AutomationHealth split and
// lib/agents-ai.ts's AiAgentConfigurationStatus: this reflects field
// completeness only, never whether REKREATIVE OS actually verified anything
// — that is verificationStatus's job, a completely separate vocabulary.
export const INTEGRATION_CONFIGURATION_STATUS_OPTIONS = [
  { id: 'configured', label: 'Configurada' },
  { id: 'incomplete', label: 'Configuración incompleta' },
] as const;
export type IntegrationConfigurationStatus = (typeof INTEGRATION_CONFIGURATION_STATUS_OPTIONS)[number]['id'];

// ── Verification status — PERSISTED (unlike configurationStatus above),
// because V1 has no live checker to derive it from: it's a manually-recorded
// claim, not a computed fact. Defaults to 'not_verified' on every connection
// and must never be seeded as anything else. The UI must never render this
// as "Conectada"/"Connected"/"Healthy"/"Operativa" — only the combined
// status+method label from getIntegrationVerificationStatusLabel below.
export const INTEGRATION_VERIFICATION_STATUS_OPTIONS = [
  { id: 'not_verified', label: 'No verificada' },
  { id: 'verified', label: 'Verificada' },
  { id: 'failed', label: 'Incidencia' },
] as const;
export type IntegrationVerificationStatus = (typeof INTEGRATION_VERIFICATION_STATUS_OPTIONS)[number]['id'];

// ── Verification method — HOW a verified/failed status was determined.
// 'manual' is the only method V1 can produce (the user checked it themselves
// outside REKREATIVE OS). 'system' is reserved for a future real backend
// verifier and is never written by this module. Always null while
// verificationStatus is 'not_verified'.
export const INTEGRATION_VERIFICATION_METHOD_OPTIONS = [
  { id: 'manual', label: 'Manual' },
  { id: 'system', label: 'Sistema' },
] as const;
export type IntegrationVerificationMethod = (typeof INTEGRATION_VERIFICATION_METHOD_OPTIONS)[number]['id'];

/** 'demo' = seeded placeholder data, 'manual' = entered by hand in this UI.
 * Same honesty rule as lib/automations.ts's AutomationDataSource — 'live' is
 * deliberately absent from V1's own type: this module has no backend/API
 * source yet, unlike Automations/Agents which at least name a future
 * external provider. */
export type IntegrationDataSource = 'demo' | 'manual';

export type IntegrationConnection = {
  id: string;

  scope: IntegrationScope;
  /** Required when scope === 'client'; always null when scope === 'internal'. */
  clientId: string | null;

  platform: IntegrationPlatform;
  name: string;

  /** Persisted — see the comment on INTEGRATION_VERIFICATION_STATUS_OPTIONS above. */
  verificationStatus: IntegrationVerificationStatus;
  /** Null iff verificationStatus === 'not_verified'; otherwise identifies how. */
  verificationMethod: IntegrationVerificationMethod | null;
  /** Null iff verificationStatus === 'not_verified'. Never a fake/seeded timestamp. */
  lastVerifiedAt: string | null;

  /** Generic external reference/label — never a platform-specific field
   *  (phoneNumber/sheetId/pageId/...) and never a secret. See lib/creds.ts /
   *  FounderOS connectors for where real credentials belong instead. */
  externalRef: string | null;
  externalLabel: string | null;

  notes: string | null;

  createdAt: string;
  updatedAt: string;

  dataSource: IntegrationDataSource;
};

export type CreateIntegrationConnectionInput = {
  scope: IntegrationScope;
  clientId?: string | null;
  platform: IntegrationPlatform;
  name: string;
  externalRef?: string | null;
  externalLabel?: string | null;
  notes?: string | null;
  dataSource?: IntegrationDataSource;
};

/** Verification fields are deliberately excluded — the only way they may
 *  change is through markIntegrationConnectionVerified/Failed/Reset below,
 *  same single-writer discipline as lib/automations.ts's appendAutomationRun
 *  owning lastRunAt/lastRunStatus/lastError. */
export type UpdateIntegrationConnectionInput = Partial<
  Omit<IntegrationConnection, 'id' | 'createdAt' | 'verificationStatus' | 'verificationMethod' | 'lastVerifiedAt'>
>;

const STORAGE_KEY = 'rek_integration_connections_v1';

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

// ===== SEED / DEMO DATA =====
// Intentionally obvious REKREATIVE-style demo connections, spread across the
// seeded REKREATIVE clients (see lib/clients.ts) plus internal/REKREATIVE
// entries. CRITICAL: every seeded row has verificationStatus 'not_verified',
// verificationMethod null, and lastVerifiedAt null — no demo connection may
// pretend REKREATIVE OS ever checked it.

function seedDemoIntegrationConnections(): IntegrationConnection[] {
  const now = new Date();
  const daysAgo = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString();
  };

  const base = {
    verificationStatus: 'not_verified' as const,
    verificationMethod: null,
    lastVerifiedAt: null,
    dataSource: 'demo' as const,
  };

  return [
    {
      id: 'connection-meta-acme',
      scope: 'client',
      clientId: 'client-acme',
      platform: 'meta',
      name: 'Meta Ads — Acme Co',
      externalRef: 'act_9384712065',
      externalLabel: 'Cuenta de anuncios Meta — Acme Co',
      notes: 'Cuenta de anuncios usada para las campañas de Full-funnel Meta Ads.',
      createdAt: daysAgo(60),
      updatedAt: daysAgo(60),
      ...base,
    },
    {
      id: 'connection-whatsapp-northwind',
      scope: 'client',
      clientId: 'client-northwind',
      platform: 'whatsapp',
      name: 'WhatsApp Business — Northwind',
      externalRef: '+1 555 0142',
      externalLabel: 'WhatsApp Comercial Northwind',
      notes: 'Número usado por las automatizaciones de recordatorio de citas.',
      createdAt: daysAgo(40),
      updatedAt: daysAgo(40),
      ...base,
    },
    {
      id: 'connection-make-internal',
      scope: 'internal',
      clientId: null,
      platform: 'make',
      name: 'Make — Workspace REKREATIVE',
      externalRef: null,
      externalLabel: 'Workspace REKREATIVE',
      notes: 'Workspace donde viven los escenarios que sirven a todos los clientes.',
      createdAt: daysAgo(90),
      updatedAt: daysAgo(90),
      ...base,
    },
    {
      id: 'connection-openai-internal',
      scope: 'internal',
      clientId: null,
      platform: 'openai',
      name: 'OpenAI — REKREATIVE',
      externalRef: null,
      externalLabel: null,
      notes: 'Cuenta interna usada por los agentes de IA para cualificación y resúmenes.',
      createdAt: daysAgo(90),
      updatedAt: daysAgo(90),
      ...base,
    },
    {
      id: 'connection-manychat-lumen',
      scope: 'client',
      clientId: 'client-lumen',
      platform: 'manychat',
      name: 'ManyChat — Lumen Studio',
      externalRef: null,
      externalLabel: null,
      notes: 'Pendiente de vincular la cuenta de ManyChat del cliente.',
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
      ...base,
    },
    {
      id: 'connection-sheets-acme',
      scope: 'client',
      clientId: 'client-acme',
      platform: 'google_sheets',
      name: 'Google Sheets — Reporting Acme',
      externalRef: null,
      externalLabel: 'Sheet de reporting mensual — Acme Co',
      notes: 'Hoja donde las automatizaciones registran leads y métricas semanales.',
      createdAt: daysAgo(75),
      updatedAt: daysAgo(0),
      ...base,
    },
  ];
}

// ===== STORE INITIALIZATION =====

export function initializeIntegrationConnectionsStoreIfNeeded(): IntegrationConnection[] {
  if (typeof window === 'undefined') {
    return seedDemoIntegrationConnections();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDemoIntegrationConnections();
    writeStorage(STORAGE_KEY, seeded);
    return seeded;
  }

  try {
    const parsed = JSON.parse(raw);
    const existing: IntegrationConnection[] = Array.isArray(parsed) ? parsed : [];
    return existing.length ? existing : seedDemoIntegrationConnections();
  } catch (error) {
    console.error('Failed to parse integration connections from localStorage; leaving existing store intact.', error);
    return seedDemoIntegrationConnections();
  }
}

// ===== READ =====

export function getIntegrationConnections(clientId?: string): IntegrationConnection[] {
  const connections = readStorage<IntegrationConnection>(STORAGE_KEY);
  const result = !clientId ? connections : connections.filter((connection) => connection.clientId === clientId);
  return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getIntegrationConnectionById(id: string): IntegrationConnection | null {
  return readStorage<IntegrationConnection>(STORAGE_KEY).find((connection) => connection.id === id) ?? null;
}

// ===== WRITE =====

function assertScopeInvariant(scope: IntegrationScope, clientId: string | null): void {
  if (scope === 'client') {
    if (!clientId) {
      throw new Error('A client-scoped integration connection requires a clientId');
    }
    const clientExists = getClients().some((client) => client.id === clientId);
    if (!clientExists) {
      throw new Error('Cannot create integration connection for a missing client id');
    }
  }
}

export function createIntegrationConnection(input: CreateIntegrationConnectionInput): IntegrationConnection {
  const clientId = input.scope === 'client' ? input.clientId ?? null : null;
  assertScopeInvariant(input.scope, clientId);

  const now = isoNow();
  const created: IntegrationConnection = {
    id: `connection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scope: input.scope,
    clientId,
    platform: input.platform,
    name: input.name.trim(),
    verificationStatus: 'not_verified',
    verificationMethod: null,
    lastVerifiedAt: null,
    externalRef: input.externalRef?.trim() || null,
    externalLabel: input.externalLabel?.trim() || null,
    notes: input.notes?.trim() || null,
    createdAt: now,
    updatedAt: now,
    dataSource: input.dataSource ?? 'manual',
  };

  const connections = readStorage<IntegrationConnection>(STORAGE_KEY);
  writeStorage(STORAGE_KEY, [created, ...connections]);
  return created;
}

export function updateIntegrationConnection(
  id: string,
  patch: UpdateIntegrationConnectionInput,
): IntegrationConnection | null {
  const connections = readStorage<IntegrationConnection>(STORAGE_KEY);
  const index = connections.findIndex((connection) => connection.id === id);
  if (index === -1) return null;

  const merged: IntegrationConnection = { ...connections[index], ...patch };

  if (merged.scope === 'internal') {
    merged.clientId = null;
  } else {
    assertScopeInvariant(merged.scope, merged.clientId);
  }

  const updated: IntegrationConnection = { ...merged, updatedAt: isoNow() };
  connections[index] = updated;
  writeStorage(STORAGE_KEY, connections);
  return updated;
}

/** The only way verificationStatus/verificationMethod/lastVerifiedAt may
 *  change to 'verified' — always method 'manual' in V1. A future real
 *  backend verifier is the only thing allowed to write method 'system'. */
export function markIntegrationConnectionVerified(id: string): IntegrationConnection | null {
  return applyVerification(id, 'verified', 'manual');
}

/** The only way to record a manually-observed problem. */
export function markIntegrationConnectionFailed(id: string): IntegrationConnection | null {
  return applyVerification(id, 'failed', 'manual');
}

/** Clears a verification claim back to the honest default. */
export function resetIntegrationConnectionVerification(id: string): IntegrationConnection | null {
  const connections = readStorage<IntegrationConnection>(STORAGE_KEY);
  const index = connections.findIndex((connection) => connection.id === id);
  if (index === -1) return null;

  const updated: IntegrationConnection = {
    ...connections[index],
    verificationStatus: 'not_verified',
    verificationMethod: null,
    lastVerifiedAt: null,
    updatedAt: isoNow(),
  };
  connections[index] = updated;
  writeStorage(STORAGE_KEY, connections);
  return updated;
}

function applyVerification(
  id: string,
  status: 'verified' | 'failed',
  method: IntegrationVerificationMethod,
): IntegrationConnection | null {
  const connections = readStorage<IntegrationConnection>(STORAGE_KEY);
  const index = connections.findIndex((connection) => connection.id === id);
  if (index === -1) return null;

  const updated: IntegrationConnection = {
    ...connections[index],
    verificationStatus: status,
    verificationMethod: method,
    lastVerifiedAt: isoNow(),
    updatedAt: isoNow(),
  };
  connections[index] = updated;
  writeStorage(STORAGE_KEY, connections);
  return updated;
}

// ===== DERIVED (never persisted) =====

/** Configuration status — always computed from field completeness, never
 * stored. Pragmatic per platform: a client-scoped connection needs an
 * external reference/label to be meaningfully configured (which account?),
 * but an internal connection does not — an internal OpenAI connection is
 * "configured" without a fake external account id. Deliberately unrelated to
 * verificationStatus — a 'configured' connection can still be
 * 'not_verified', and REKREATIVE OS never conflates the two. */
export function getIntegrationConfigurationStatus(
  connection: Pick<IntegrationConnection, 'name' | 'platform' | 'scope' | 'clientId' | 'externalRef' | 'externalLabel'>,
): IntegrationConfigurationStatus {
  const hasName = connection.name.trim().length > 0;
  const hasPlatform = Boolean(connection.platform);
  const hasScope = connection.scope === 'internal' || Boolean(connection.clientId);
  const hasExternalReference =
    connection.scope === 'internal' ||
    Boolean(connection.externalRef?.trim()) ||
    Boolean(connection.externalLabel?.trim());
  return hasName && hasPlatform && hasScope && hasExternalReference ? 'configured' : 'incomplete';
}

export type IntegrationConnectionsSummary = {
  configured: number;
  incomplete: number;
  notVerified: number;
  incidents: number;
};

/** KPI totals over a set of connections — computed from whatever set is
 * passed in, so callers recompute from the currently filtered list. */
export function summarizeIntegrationConnections(connections: IntegrationConnection[]): IntegrationConnectionsSummary {
  return {
    configured: connections.filter((c) => getIntegrationConfigurationStatus(c) === 'configured').length,
    incomplete: connections.filter((c) => getIntegrationConfigurationStatus(c) === 'incomplete').length,
    notVerified: connections.filter((c) => c.verificationStatus === 'not_verified').length,
    incidents: connections.filter((c) => c.verificationStatus === 'failed').length,
  };
}

// ===== LABELS =====

export function getClientNameForIntegrationConnection(clientId: string | null): string {
  if (!clientId) return 'Interno';
  const client = getClients().find((item) => item.id === clientId);
  return client?.name ?? 'Cliente desconocido';
}

export function getIntegrationScopeLabel(scope: IntegrationScope): string {
  return INTEGRATION_SCOPE_OPTIONS.find((option) => option.id === scope)?.label ?? scope;
}

export function getIntegrationPlatformLabel(platform: IntegrationPlatform): string {
  return INTEGRATION_PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ?? platform;
}

export function getIntegrationConfigurationStatusLabel(status: IntegrationConfigurationStatus): string {
  return INTEGRATION_CONFIGURATION_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}

/** The one honesty-critical label helper: combines verificationStatus AND
 * verificationMethod so V1 (method always 'manual' or null) and a future
 * system verifier (method 'system') render distinct, truthful copy — never
 * "Conectada"/"Connected"/"Healthy"/"Operativa". */
export function getIntegrationVerificationStatusLabel(
  connection: Pick<IntegrationConnection, 'verificationStatus' | 'verificationMethod'>,
): string {
  const { verificationStatus, verificationMethod } = connection;
  if (verificationStatus === 'not_verified') return 'No verificada';
  const bySystem = verificationMethod === 'system';
  if (verificationStatus === 'verified') return bySystem ? 'Verificada por sistema' : 'Verificada manualmente';
  return bySystem ? 'Incidencia detectada por sistema' : 'Incidencia detectada manualmente';
}

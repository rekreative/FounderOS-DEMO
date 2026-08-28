import { getClients } from '@/lib/clients';

// Integrations / Connection Health V1 — a management layer over WHICH
// external tools REKREATIVE and its clients use, NOT a live connector. This
// module never calls an external API and never derives status from a real
// check — same honesty rule as lib/automations.ts's AutomationDataSource and
// lib/agents-ai.ts's AiAgentDataSource, and deliberately isolated from
// FounderOS's real lib/connectors/* + app/integrations (machine-bound,
// secret-writing infrastructure this module must never touch or resemble).
//
// Connections/Secrets V1: persistence lives in
// lib/server/integration-connections-repo.ts (server) and
// lib/api/integration-connections.ts (browser), reached over
// GET/POST /api/integration-connections and
// PATCH /api/integration-connections/[id]. This module keeps only the
// IntegrationConnection type, its controlled enums/labels, and pure/
// presentational helpers shared by both the API layer and the components —
// nothing here reads or writes localStorage anymore.

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
// claim, not a computed fact. Defaults to 'not_verified' on every connection.
// The UI must never render this as "Conectada"/"Connected"/"Healthy"/
// "Operativa" — only the combined status+method label from
// getIntegrationVerificationStatusLabel below.
export const INTEGRATION_VERIFICATION_STATUS_OPTIONS = [
  { id: 'not_verified', label: 'No verificada' },
  { id: 'verified', label: 'Verificada' },
  { id: 'failed', label: 'Incidencia' },
] as const;
export type IntegrationVerificationStatus = (typeof INTEGRATION_VERIFICATION_STATUS_OPTIONS)[number]['id'];

// ── Verification method — HOW a verified/failed status was determined.
// 'manual' is the only method V1 can produce (the user checked it themselves
// outside REKREATIVE OS). 'system' is reserved for a future real backend
// verifier and is never written by the API. Always null while
// verificationStatus is 'not_verified'.
export const INTEGRATION_VERIFICATION_METHOD_OPTIONS = [
  { id: 'manual', label: 'Manual' },
  { id: 'system', label: 'Sistema' },
] as const;
export type IntegrationVerificationMethod = (typeof INTEGRATION_VERIFICATION_METHOD_OPTIONS)[number]['id'];

// ── Record status — archive/restore without a hard delete (Connections/
// Secrets V1). New relative to the old localStorage model, which had no
// archive concept at all. Active records are the default view everywhere;
// archived ones are reached through an explicit, minimal toggle.
export const INTEGRATION_RECORD_STATUS_OPTIONS = [
  { id: 'active', label: 'Activa' },
  { id: 'archived', label: 'Archivada' },
] as const;
export type IntegrationRecordStatus = (typeof INTEGRATION_RECORD_STATUS_OPTIONS)[number]['id'];

/** 'demo' = seeded placeholder data, 'manual' = entered by hand in this UI.
 * Same honesty rule as lib/automations.ts's AutomationDataSource — 'live' is
 * deliberately absent from V1's own type: this module has no backend/API
 * source of live connector truth, unlike Automations/Agents which at least
 * name a future external provider. No 'demo' row is ever written by the API
 * in Phase 1 — production starts empty. */
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

  /** Archive/restore without a hard delete — see INTEGRATION_RECORD_STATUS_OPTIONS. */
  status: IntegrationRecordStatus;

  createdAt: string;
  updatedAt: string;

  dataSource: IntegrationDataSource;
};

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
 * passed in, so callers recompute from the currently filtered list (active
 * or archived, whichever is on screen). */
export function summarizeIntegrationConnections(connections: IntegrationConnection[]): IntegrationConnectionsSummary {
  return {
    configured: connections.filter((c) => getIntegrationConfigurationStatus(c) === 'configured').length,
    incomplete: connections.filter((c) => getIntegrationConfigurationStatus(c) === 'incomplete').length,
    notVerified: connections.filter((c) => c.verificationStatus === 'not_verified').length,
    incidents: connections.filter((c) => c.verificationStatus === 'failed').length,
  };
}

// ===== LABELS =====

/** See lib/knowledge-entries.ts's getClientNameForKnowledgeEntry — same
 *  pattern: pass the canonical PostgreSQL `clients` list when the caller has
 *  one loaded (every current caller does, via useClientsRegistry()). */
export function getClientNameForIntegrationConnection(
  clientId: string | null,
  clients: { id: string; name: string }[] = getClients(),
): string {
  if (!clientId) return 'Interno';
  const client = clients.find((item) => item.id === clientId);
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

export function getIntegrationRecordStatusLabel(status: IntegrationRecordStatus): string {
  return INTEGRATION_RECORD_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
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

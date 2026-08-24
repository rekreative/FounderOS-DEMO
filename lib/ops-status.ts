// Shared, client-safe status vocabulary for the Real V1 operational
// evidence layer (Connections/Automations/AI Agents/Home). Deliberately has
// NO server-only imports (no `pg`, no lib/server/*) so UI components can
// import it directly — the actual Postgres-derived evidence lives in
// lib/server/ops-status.ts and reaches the browser only through
// GET /api/ops/status (see lib/api/ops-status.ts).
//
// CONFIGURED != OPERATIONAL != ACTIVITY_OBSERVED. See lib/server/ops-status.ts
// for exactly how each value is derived per integration/workflow/agent.

export const OPS_STATUS_OPTIONS = [
  { id: 'operational', label: 'Operativo' },
  { id: 'activity_observed', label: 'Actividad observada' },
  { id: 'configured', label: 'Configurado' },
  { id: 'needs_attention', label: 'Requiere atención' },
  { id: 'not_configured', label: 'No configurado' },
  { id: 'unknown', label: 'No observable' },
  { id: 'demo', label: 'Demo' },
] as const;

export type OpsStatus = (typeof OPS_STATUS_OPTIONS)[number]['id'];

export function getOpsStatusLabel(status: OpsStatus): string {
  return OPS_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}

/** Maps to components/terminal.tsx's BadgeTone — kept as plain strings here
 * (rather than importing BadgeTone) so this module has zero React/component
 * dependency and stays trivially importable from lib/server/ops-status.ts's
 * doc comments and tests. */
export const OPS_STATUS_TONE: Record<OpsStatus, 'default' | 'accent' | 'ok' | 'warn' | 'err'> = {
  operational: 'ok',
  activity_observed: 'ok',
  configured: 'accent',
  needs_attention: 'err',
  not_configured: 'warn',
  unknown: 'default',
  demo: 'default',
};

export type OpsEvidenceClient = {
  clientId: string;
  clientName: string;
  lastActivityAt: string;
};

export type OpsConnectionId = 'postgresql' | 'make' | 'meta_ads' | 'openai' | 'whatsapp' | 'google_sheets';

export type OpsConnectionStatus = {
  id: OpsConnectionId;
  name: string;
  status: OpsStatus;
  detail: string;
  lastActivityAt: string | null;
};

export type OpsAutomationId = 'lead_intake' | 'lead_qualification' | 'whatsapp_outbound' | 'whatsapp_inbound' | 'commercial_lifecycle';

export type OpsAutomationStatus = {
  id: OpsAutomationId;
  name: string;
  purpose: string;
  execution: string;
  status: OpsStatus;
  detail: string;
  lastActivityAt: string | null;
  clients: OpsEvidenceClient[];
};

export type OpsAgentStatus = {
  id: 'lead_qualification_agent';
  name: string;
  provider: string;
  execution: string;
  status: OpsStatus;
  detail: string;
  lastActivityAt: string | null;
  clients: OpsEvidenceClient[];
};

export type OpsAttentionItem = {
  id: string;
  text: string;
};

export type OpsSnapshot = {
  postgres: { configured: boolean; status: OpsStatus; detail: string };
  connections: OpsConnectionStatus[];
  automations: OpsAutomationStatus[];
  agent: OpsAgentStatus;
  attention: OpsAttentionItem[];
};

export function formatOpsRelativeTime(value: string | null): string {
  if (!value) return 'Sin actividad observada';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffHours = Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours < 1) return 'hace menos de 1h';
  if (diffHours < 24) return `hace ${Math.round(diffHours)}h`;
  return `hace ${Math.round(diffHours / 24)}d`;
}

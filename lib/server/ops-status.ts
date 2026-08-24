import { query } from './db';
import {
  type OpsAgentStatus,
  type OpsAttentionItem,
  type OpsAutomationId,
  type OpsAutomationStatus,
  type OpsClientAgentStatus,
  type OpsClientAutomationStatus,
  type OpsClientSnapshot,
  type OpsConnectionStatus,
  type OpsEvidenceClient,
  type OpsSnapshot,
  type OpsStatus,
} from '../ops-status';

/**
 * Real V1 operational-evidence layer for Connections/Automations/AI
 * Agents/Home. Server-only (imports lib/server/db's pg pool) — never import
 * this from a 'use client' component; the browser reaches it exclusively
 * through GET /api/ops/status (see lib/api/ops-status.ts).
 *
 * Every signal here is either:
 *  - a REKREATIVE OS-side config check (env var presence, or a real
 *    PostgreSQL `SELECT 1`), or
 *  - PASSIVE evidence derived from existing lead_events/leads rows that
 *    Make/OpenAI/WhatsApp already caused REKREATIVE OS to record.
 * This module never calls Meta/OpenAI/WhatsApp/Make/Google Sheets — see
 * the architecture note in CLAUDE.md and the milestone brief: no active
 * external health pings in V1.
 *
 * CONFIGURED != OPERATIONAL != ACTIVITY_OBSERVED (lib/ops-status.ts):
 *  - operational: a real health check REKREATIVE OS owns is currently
 *    succeeding (PostgreSQL only, in this pass).
 *  - activity_observed: real lead_events prove the workflow produced
 *    activity — the strongest signal V1 has for anything Make/Meta/
 *    OpenAI/WhatsApp owns, since REKREATIVE OS cannot query those
 *    providers directly.
 *  - configured: REKREATIVE OS-side configuration exists (an API key is
 *    set) but no evidence has been observed yet — NOT an error; a quiet
 *    client may simply have no new leads.
 *  - not_configured / unknown / needs_attention: see each branch below.
 */

const ALL_LEAD_EVENT_TYPES_FOR_META = ['lead_received'];
const AI_ANALYZED = ['ai_analyzed'];
const WHATSAPP_SENT = ['whatsapp_sent'];
const WHATSAPP_REPLIED = ['lead_replied'];
const COMMERCIAL_TYPES = ['appointment_booked', 'appointment_completed', 'converted', 'disqualified'];

type EvidenceRow = { client_id: string | null; client_name: string | null; last_activity: Date };

type EvidenceQuery = {
  eventTypes?: string[];
  source?: string;
  ingestionSourceIlike?: string;
  /**
   * Client Truth Alignment V1: scopes the query to one PostgreSQL
   * clients.id. When set, the `LIMIT 6` below is dropped — GROUP BY
   * client_id already collapses to at most one row once client_id is
   * pinned by an equality filter, so the limit is moot, and more
   * importantly this is the fix for the global evidence query's blind
   * spot: getOpsSnapshot()'s unscoped queries only ever see the 6
   * most-recently-active clients per signal, so a specific client's real
   * evidence could silently fail to surface if 6+ other clients were more
   * recently active. A clientId-scoped query can never hit that limit.
   */
  clientId?: string;
};

type Evidence = { lastActivityAt: string | null; clients: OpsEvidenceClient[] };

/**
 * ONE bounded query per evidence signal (GROUP BY client_id, LIMIT 6 when
 * unscoped) — never N+1 per client. Real PostgreSQL clients only (LEFT JOIN
 * clients), never lib/clients.ts's localStorage roster. A lead with no
 * client (scope 'internal') contributes to lastActivityAt but never to the
 * `clients` list.
 */
async function getLatestEvidence(opts: EvidenceQuery): Promise<Evidence> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.eventTypes && opts.eventTypes.length > 0) {
    params.push(opts.eventTypes);
    conditions.push(`e.type = ANY($${params.length})`);
  }
  if (opts.source) {
    params.push(opts.source);
    conditions.push(`e.source = $${params.length}`);
  }
  if (opts.ingestionSourceIlike) {
    params.push(opts.ingestionSourceIlike);
    conditions.push(`l.ingestion_source ILIKE $${params.length}`);
  }
  if (opts.clientId) {
    params.push(opts.clientId);
    conditions.push(`l.client_id = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = opts.clientId ? '' : 'LIMIT 6';
  const result = await query<EvidenceRow>(
    `SELECT l.client_id, c.name AS client_name, MAX(e.occurred_at) AS last_activity
     FROM lead_events e
     JOIN leads l ON l.id = e.lead_id
     LEFT JOIN clients c ON c.id = l.client_id
     ${where}
     GROUP BY l.client_id, c.name
     ORDER BY last_activity DESC
     ${limitClause}`,
    params,
  );

  const lastActivityAt = result.rows[0]?.last_activity ? result.rows[0].last_activity.toISOString() : null;
  const clients: OpsEvidenceClient[] = result.rows
    .filter((row): row is EvidenceRow & { client_id: string } => row.client_id !== null)
    .map((row) => ({
      clientId: row.client_id,
      clientName: row.client_name ?? 'Cliente desconocido',
      lastActivityAt: row.last_activity.toISOString(),
    }));

  return { lastActivityAt, clients };
}

/** configured-vs-evidence status ladder shared by every Make-mediated
 * workflow/connection: real evidence beats configuration, configuration
 * beats nothing. Never returns needs_attention — REKREATIVE OS cannot
 * observe a Make-side failure, only its absence, which is neutral. */
function evidenceLadderStatus(hasEvidence: boolean, configured: boolean): OpsStatus {
  if (hasEvidence) return 'activity_observed';
  return configured ? 'configured' : 'not_configured';
}

/** Same ladder for signals REKREATIVE OS has no config surface for at all
 * (Meta/OpenAI/WhatsApp Cloud — Make/the provider owns the account, not
 * this OS) — configured is never a valid state, only observed-or-unknown. */
function externalEvidenceStatus(hasEvidence: boolean): OpsStatus {
  return hasEvidence ? 'activity_observed' : 'unknown';
}

/**
 * Single source of truth for the 5 canonical workflows' static copy
 * (name/purpose/execution) and per-quiet-state detail text. Both
 * getOpsSnapshot() (global) and getClientOpsSnapshot() (Client Truth
 * Alignment V1, per-clients.id) build their OpsAutomationStatus /
 * OpsClientAutomationStatus rows from this ONE list + deriveAutomationStatus
 * below, so the two views can never drift on what a workflow is called or
 * what its status means.
 */
type AutomationDefinition = {
  id: OpsAutomationId;
  name: string;
  purpose: string;
  execution: string;
  /** Which REKREATIVE-OS-side key gates the configured/not_configured floor. */
  configuredBy: 'ingest' | 'makeEvents';
  activeDetail: string;
  configuredQuietDetail: string;
  notConfiguredDetail: string;
};

const AUTOMATION_DEFINITIONS: AutomationDefinition[] = [
  {
    id: 'lead_intake',
    name: 'Captación de leads (Meta → Make)',
    purpose: 'Recibe leads de Meta Lead Ads a través de Make y los registra en el CRM.',
    execution: 'Make',
    configuredBy: 'ingest',
    activeDetail: 'Actividad real observada.',
    configuredQuietDetail: 'Endpoint de ingesta configurado; sin leads de Meta observados todavía.',
    notConfiguredDetail: 'Endpoint de ingesta (INGEST_API_KEY) no configurado.',
  },
  {
    id: 'lead_qualification',
    name: 'Cualificación de leads',
    purpose: 'OpenAI cualifica el lead dentro del escenario de Make antes de registrarlo.',
    execution: 'Make + OpenAI',
    configuredBy: 'ingest',
    activeDetail: 'Actividad real observada.',
    configuredQuietDetail: 'Endpoint de ingesta configurado; sin cualificaciones observadas todavía.',
    notConfiguredDetail: 'Endpoint de ingesta (INGEST_API_KEY) no configurado.',
  },
  {
    id: 'whatsapp_outbound',
    name: 'WhatsApp saliente',
    purpose: 'Envío de plantillas de WhatsApp Business Cloud vía Make.',
    execution: 'Make',
    configuredBy: 'makeEvents',
    activeDetail: 'Actividad real observada.',
    configuredQuietDetail: 'Endpoint de eventos configurado; sin envíos observados todavía.',
    notConfiguredDetail: 'Endpoint de eventos (MAKE_EVENTS_API_KEY) no configurado.',
  },
  {
    id: 'whatsapp_inbound',
    name: 'WhatsApp entrante',
    purpose: 'Respuestas de WhatsApp Business Cloud relayadas por Make.',
    execution: 'Make',
    configuredBy: 'makeEvents',
    activeDetail: 'Actividad real observada.',
    configuredQuietDetail: 'Endpoint de eventos configurado; sin respuestas observadas todavía.',
    notConfiguredDetail: 'Endpoint de eventos (MAKE_EVENTS_API_KEY) no configurado.',
  },
  {
    id: 'commercial_lifecycle',
    name: 'Ciclo de vida comercial',
    purpose: 'Citas, conversiones y descalificaciones reportadas por Make (nunca acciones manuales).',
    execution: 'Make',
    configuredBy: 'makeEvents',
    activeDetail: 'Actividad real observada (solo eventos originados por Make).',
    configuredQuietDetail: 'Endpoint de eventos configurado; sin eventos comerciales de Make observados todavía.',
    notConfiguredDetail: 'Endpoint de eventos (MAKE_EVENTS_API_KEY) no configurado.',
  },
];

function isAutomationConfigured(def: AutomationDefinition, ingestConfigured: boolean, makeEventsConfigured: boolean): boolean {
  return def.configuredBy === 'ingest' ? ingestConfigured : makeEventsConfigured;
}

/** Builds everything but `clients` — getOpsSnapshot() attaches evidence.clients
 * on top (global), getClientOpsSnapshot() returns this as-is (already
 * client-scoped, so a per-row client list would be redundant). */
function deriveAutomationStatus(
  def: AutomationDefinition,
  evidence: { lastActivityAt: string | null },
  configured: boolean,
): Omit<OpsAutomationStatus, 'clients'> {
  const hasEvidence = evidence.lastActivityAt !== null;
  return {
    id: def.id,
    name: def.name,
    purpose: def.purpose,
    execution: def.execution,
    status: evidenceLadderStatus(hasEvidence, configured),
    detail: hasEvidence ? def.activeDetail : configured ? def.configuredQuietDetail : def.notConfiguredDetail,
    lastActivityAt: evidence.lastActivityAt,
  };
}

/** Same single-source-of-truth discipline as AUTOMATION_DEFINITIONS, for the
 * one Lead Qualification Agent. */
const AGENT_DEFINITION = {
  id: 'lead_qualification_agent' as const,
  name: 'Agente de Cualificación de Leads',
  provider: 'OpenAI',
  execution: 'Make + OpenAI',
  activeDetail: 'Actividad real observada — REKREATIVE OS supervisa este agente a través de eventos ai_analyzed, no lo ejecuta.',
  configuredQuietDetail: 'Endpoint de ingesta configurado; sin cualificaciones observadas todavía.',
  notConfiguredDetail: 'Endpoint de ingesta (INGEST_API_KEY) no configurado.',
};

function deriveAgentStatus(evidence: { lastActivityAt: string | null }, ingestConfigured: boolean): Omit<OpsAgentStatus, 'clients'> {
  const hasEvidence = evidence.lastActivityAt !== null;
  return {
    id: AGENT_DEFINITION.id,
    name: AGENT_DEFINITION.name,
    provider: AGENT_DEFINITION.provider,
    execution: AGENT_DEFINITION.execution,
    status: evidenceLadderStatus(hasEvidence, ingestConfigured),
    detail: hasEvidence ? AGENT_DEFINITION.activeDetail : ingestConfigured ? AGENT_DEFINITION.configuredQuietDetail : AGENT_DEFINITION.notConfiguredDetail,
    lastActivityAt: evidence.lastActivityAt,
  };
}

async function getPostgresHealth(databaseUrlConfigured: boolean): Promise<{ configured: boolean; status: OpsStatus; detail: string }> {
  if (!databaseUrlConfigured) {
    return { configured: false, status: 'not_configured', detail: 'DATABASE_URL no está configurada.' };
  }
  try {
    await query('SELECT 1');
    return { configured: true, status: 'operational', detail: 'Conexión a PostgreSQL verificada.' };
  } catch (error) {
    // Never logs the connection string — pg query errors don't carry it,
    // and DATABASE_URL itself is never interpolated into this log line.
    console.error('[ops-status] PostgreSQL health check failed:', error);
    return { configured: true, status: 'needs_attention', detail: 'PostgreSQL está configurada pero la comprobación de conexión está fallando.' };
  }
}

function buildAttention(
  databaseUrlConfigured: boolean,
  postgresStatus: OpsStatus,
  ingestConfigured: boolean,
  makeEventsConfigured: boolean,
): OpsAttentionItem[] {
  const attention: OpsAttentionItem[] = [];

  if (!databaseUrlConfigured) {
    attention.push({ id: 'db-not-configured', text: 'PostgreSQL no está configurada (falta DATABASE_URL).' });
  } else if (postgresStatus === 'needs_attention') {
    attention.push({ id: 'db-health-failed', text: 'PostgreSQL está configurada pero la comprobación de conexión está fallando.' });
  }

  if (!ingestConfigured) {
    attention.push({
      id: 'ingest-key-missing',
      text: 'Falta configurar INGEST_API_KEY — el endpoint de ingesta de leads de Make no está operativo.',
    });
  }
  if (!makeEventsConfigured) {
    attention.push({
      id: 'make-events-key-missing',
      text: 'Falta configurar MAKE_EVENTS_API_KEY — los eventos de WhatsApp y del ciclo comercial de Make no pueden reportarse.',
    });
  }

  return attention;
}

/** Degraded snapshot when PostgreSQL is not usable — every DB-dependent
 * status falls back to what's knowable from env alone (never 'unknown'
 * pretending to be 'activity_observed', never a query attempted). */
function unavailableSnapshot(
  postgres: { configured: boolean; status: OpsStatus; detail: string },
  ingestConfigured: boolean,
  makeEventsConfigured: boolean,
  attention: OpsAttentionItem[],
): OpsSnapshot {
  const makeStatus: OpsStatus = ingestConfigured || makeEventsConfigured ? 'configured' : 'not_configured';

  const connections: OpsConnectionStatus[] = [
    { id: 'postgresql', name: 'PostgreSQL', status: postgres.status, detail: postgres.detail, lastActivityAt: null },
    {
      id: 'make',
      name: 'Make',
      status: makeStatus,
      detail: 'No se puede comprobar la actividad real: PostgreSQL no está disponible.',
      lastActivityAt: null,
    },
    { id: 'meta_ads', name: 'Meta Lead Ads', status: 'unknown', detail: 'No observable sin conexión a PostgreSQL.', lastActivityAt: null },
    { id: 'openai', name: 'OpenAI (vía Make)', status: 'unknown', detail: 'No observable sin conexión a PostgreSQL.', lastActivityAt: null },
    { id: 'whatsapp', name: 'WhatsApp Business Cloud', status: 'unknown', detail: 'No observable sin conexión a PostgreSQL.', lastActivityAt: null },
    {
      id: 'google_sheets',
      name: 'Google Sheets',
      status: 'unknown',
      detail: 'Gestionado desde Make. No observable desde REKREATIVE OS.',
      lastActivityAt: null,
    },
  ];

  const degradedWorkflow = (
    id: OpsAutomationStatus['id'],
    name: string,
    purpose: string,
    execution: string,
    configured: boolean,
  ): OpsAutomationStatus => ({
    id,
    name,
    purpose,
    execution,
    status: configured ? 'configured' : 'not_configured',
    detail: 'No se puede comprobar la actividad real: PostgreSQL no está disponible.',
    lastActivityAt: null,
    clients: [],
  });

  const automations: OpsAutomationStatus[] = [
    degradedWorkflow('lead_intake', 'Captación de leads (Meta → Make)', 'Recibe leads de Meta Lead Ads a través de Make.', 'Make', ingestConfigured),
    degradedWorkflow('lead_qualification', 'Cualificación de leads', 'OpenAI cualifica el lead dentro del escenario de Make.', 'Make + OpenAI', ingestConfigured),
    degradedWorkflow('whatsapp_outbound', 'WhatsApp saliente', 'Envío de plantillas de WhatsApp Business Cloud vía Make.', 'Make', makeEventsConfigured),
    degradedWorkflow('whatsapp_inbound', 'WhatsApp entrante', 'Respuestas de WhatsApp Business Cloud relayadas por Make.', 'Make', makeEventsConfigured),
    degradedWorkflow(
      'commercial_lifecycle',
      'Ciclo de vida comercial',
      'Citas, conversiones y descalificaciones reportadas por Make.',
      'Make',
      makeEventsConfigured,
    ),
  ];

  const agent: OpsAgentStatus = {
    id: 'lead_qualification_agent',
    name: 'Agente de Cualificación de Leads',
    provider: 'OpenAI',
    execution: 'Make + OpenAI',
    status: ingestConfigured ? 'configured' : 'not_configured',
    detail: 'No se puede comprobar la actividad real: PostgreSQL no está disponible.',
    lastActivityAt: null,
    clients: [],
  };

  return { postgres, connections, automations, agent, attention };
}

export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL);
  const ingestConfigured = Boolean(process.env.INGEST_API_KEY);
  const makeEventsConfigured = Boolean(process.env.MAKE_EVENTS_API_KEY);

  const postgres = await getPostgresHealth(databaseUrlConfigured);
  const attention = buildAttention(databaseUrlConfigured, postgres.status, ingestConfigured, makeEventsConfigured);

  if (postgres.status !== 'operational') {
    return unavailableSnapshot(postgres, ingestConfigured, makeEventsConfigured, attention);
  }

  const [metaIntake, qualification, whatsappOut, whatsappIn, makeAny, commercialMake] = await Promise.all([
    getLatestEvidence({ eventTypes: ALL_LEAD_EVENT_TYPES_FOR_META, ingestionSourceIlike: '%meta%' }),
    getLatestEvidence({ eventTypes: AI_ANALYZED }),
    getLatestEvidence({ eventTypes: WHATSAPP_SENT }),
    getLatestEvidence({ eventTypes: WHATSAPP_REPLIED }),
    getLatestEvidence({ source: 'make' }),
    getLatestEvidence({ eventTypes: COMMERCIAL_TYPES, source: 'make' }),
  ]);

  const makeConfigured = ingestConfigured || makeEventsConfigured;
  const makeStatus = evidenceLadderStatus(makeAny.lastActivityAt !== null, makeConfigured);
  const metaStatus = externalEvidenceStatus(metaIntake.lastActivityAt !== null);
  const openaiStatus = externalEvidenceStatus(qualification.lastActivityAt !== null);
  const whatsappLastActivityAt = [whatsappOut.lastActivityAt, whatsappIn.lastActivityAt]
    .filter((v): v is string => v !== null)
    .sort()
    .at(-1) ?? null;
  const whatsappStatus = externalEvidenceStatus(whatsappLastActivityAt !== null);

  const connections: OpsConnectionStatus[] = [
    { id: 'postgresql', name: 'PostgreSQL', status: postgres.status, detail: postgres.detail, lastActivityAt: null },
    {
      id: 'make',
      name: 'Make',
      status: makeStatus,
      detail:
        makeStatus === 'activity_observed'
          ? 'Actividad real de Make observada en Leads/LeadEvents.'
          : makeConfigured
            ? 'Claves de recepción configuradas; sin actividad observada todavía.'
            : 'Sin claves de recepción configuradas (INGEST_API_KEY / MAKE_EVENTS_API_KEY).',
      lastActivityAt: makeAny.lastActivityAt,
    },
    {
      id: 'meta_ads',
      name: 'Meta Lead Ads',
      status: metaStatus,
      detail:
        metaStatus === 'activity_observed'
          ? 'Entrada de leads observada — un lead de Meta llegó correctamente a REKREATIVE OS.'
          : 'Sin evidencia de leads de Meta todavía. No implica un problema de cuenta: REKREATIVE OS no verifica la cuenta de Meta directamente.',
      lastActivityAt: metaIntake.lastActivityAt,
    },
    {
      id: 'openai',
      name: 'OpenAI (vía Make)',
      status: openaiStatus,
      detail:
        openaiStatus === 'activity_observed'
          ? 'Cualificación de IA observada — REKREATIVE OS no realiza la llamada a OpenAI, solo registra su resultado.'
          : 'Sin cualificaciones de IA observadas todavía. La llamada a OpenAI ocurre dentro de Make, fuera de REKREATIVE OS.',
      lastActivityAt: qualification.lastActivityAt,
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp Business Cloud',
      status: whatsappStatus,
      detail:
        whatsappStatus === 'activity_observed'
          ? 'Actividad de WhatsApp observada. La integración y los eventos del proveedor se gestionan vía Make.'
          : 'Sin actividad de WhatsApp observada todavía. La integración y los eventos del proveedor se gestionan vía Make.',
      lastActivityAt: whatsappLastActivityAt,
    },
    {
      id: 'google_sheets',
      name: 'Google Sheets',
      status: 'unknown',
      detail: 'Gestionado desde Make. No observable desde REKREATIVE OS.',
      lastActivityAt: null,
    },
  ];

  const evidenceById: Record<OpsAutomationId, Evidence> = {
    lead_intake: metaIntake,
    lead_qualification: qualification,
    whatsapp_outbound: whatsappOut,
    whatsapp_inbound: whatsappIn,
    commercial_lifecycle: commercialMake,
  };

  const automations: OpsAutomationStatus[] = AUTOMATION_DEFINITIONS.map((def) => {
    const evidence = evidenceById[def.id];
    const configured = isAutomationConfigured(def, ingestConfigured, makeEventsConfigured);
    return { ...deriveAutomationStatus(def, evidence, configured), clients: evidence.clients };
  });

  const agent: OpsAgentStatus = { ...deriveAgentStatus(qualification, ingestConfigured), clients: qualification.clients };

  return { postgres, connections, automations, agent, attention };
}

/**
 * Client Truth Alignment V1 — the same 5 workflows + 1 agent as
 * getOpsSnapshot(), scoped to one PostgreSQL clients.id instead of the
 * global top-6-most-recently-active evidence. Reuses AUTOMATION_DEFINITIONS/
 * AGENT_DEFINITION and deriveAutomationStatus/deriveAgentStatus — the exact
 * same status ladder and status/detail text as the global snapshot — so the
 * two views can never disagree on what a status means, only on which
 * client's evidence backs it. No `clients` field: evidence is already
 * scoped to one client, so a per-row client list is redundant here.
 */
export async function getClientOpsSnapshot(clientId: string): Promise<OpsClientSnapshot> {
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL);
  const ingestConfigured = Boolean(process.env.INGEST_API_KEY);
  const makeEventsConfigured = Boolean(process.env.MAKE_EVENTS_API_KEY);

  const postgres = await getPostgresHealth(databaseUrlConfigured);

  if (postgres.status !== 'operational') {
    const automations: OpsClientAutomationStatus[] = AUTOMATION_DEFINITIONS.map((def) => ({
      id: def.id,
      name: def.name,
      purpose: def.purpose,
      execution: def.execution,
      status: isAutomationConfigured(def, ingestConfigured, makeEventsConfigured) ? 'configured' : 'not_configured',
      detail: 'No se puede comprobar la actividad real: PostgreSQL no está disponible.',
      lastActivityAt: null,
    }));

    const agent: OpsClientAgentStatus = {
      id: AGENT_DEFINITION.id,
      name: AGENT_DEFINITION.name,
      provider: AGENT_DEFINITION.provider,
      execution: AGENT_DEFINITION.execution,
      status: ingestConfigured ? 'configured' : 'not_configured',
      detail: 'No se puede comprobar la actividad real: PostgreSQL no está disponible.',
      lastActivityAt: null,
    };

    return { automations, agent };
  }

  const [metaIntake, qualification, whatsappOut, whatsappIn, commercialMake] = await Promise.all([
    getLatestEvidence({ eventTypes: ALL_LEAD_EVENT_TYPES_FOR_META, ingestionSourceIlike: '%meta%', clientId }),
    getLatestEvidence({ eventTypes: AI_ANALYZED, clientId }),
    getLatestEvidence({ eventTypes: WHATSAPP_SENT, clientId }),
    getLatestEvidence({ eventTypes: WHATSAPP_REPLIED, clientId }),
    getLatestEvidence({ eventTypes: COMMERCIAL_TYPES, source: 'make', clientId }),
  ]);

  const evidenceById: Record<OpsAutomationId, Evidence> = {
    lead_intake: metaIntake,
    lead_qualification: qualification,
    whatsapp_outbound: whatsappOut,
    whatsapp_inbound: whatsappIn,
    commercial_lifecycle: commercialMake,
  };

  const automations: OpsClientAutomationStatus[] = AUTOMATION_DEFINITIONS.map((def) =>
    deriveAutomationStatus(def, evidenceById[def.id], isAutomationConfigured(def, ingestConfigured, makeEventsConfigured)),
  );

  const agent: OpsClientAgentStatus = deriveAgentStatus(qualification, ingestConfigured);

  return { automations, agent };
}

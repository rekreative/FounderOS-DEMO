import type { Client, ClientStatus } from '@/lib/clients';
import type { Lead, LeadEvent, LeadIntent, LeadPriority } from '@/lib/leads';
import { buildLeadFunnel, sumFunnelCounts, type LeadFunnelCounts } from '@/lib/results';
import type { MetaCampaign, MetaCampaignObjective, MetaCampaignStatus } from '@/lib/meta-ads';
import {
  getAutomationHealth,
  getAutomationRunStats,
  type Automation,
  type AutomationPlatform,
  type AutomationRun,
  type AutomationRunStats,
  type AutomationType,
} from '@/lib/automations';
import {
  getAiAgentConfigurationStatus,
  type AiAgent,
  type AiAgentChannel,
  type AiAgentProvider,
  type AiAgentUseCase,
} from '@/lib/agents-ai';
import type { IntegrationConnection } from '@/lib/integration-connections';
import {
  summarizeClientOnboarding,
  type ClientIntegrationRequirement,
  type ClientOnboardingSummary,
} from '@/lib/client-integration-requirements';

// REKREATIVE Analytics V1 — cross-portfolio pattern derivation. Pure functions
// only: every export here takes already-fetched arrays (from each domain
// module's own get*()/initialize*StoreIfNeeded()) and derives, never
// persists. No Analytics-specific localStorage key exists or should ever
// exist. This module answers "what patterns/strengths/weaknesses/gaps exist
// across the portfolio" — it deliberately does NOT recompute anything
// Results already owns (attributed revenue, ROAS, CAC, period-scoped ad
// performance, the Results funnel dashboard, Meta vs CRM comparison). Where a
// derivation already exists in another module (buildLeadFunnel,
// getAutomationHealth, getAiAgentConfigurationStatus,
// summarizeClientOnboarding, ...) this module reuses it rather than
// re-deriving equivalent business logic.

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

// ===== 1. Portfolio composition =====

export type PortfolioComposition = {
  totalClients: number;
  byStatus: { status: ClientStatus; count: number }[];
  bySector: { key: string; count: number }[];
  byService: { key: string; count: number }[];
  totalContractedMetaBudget: number;
  clientsWithBudget: number;
  /** Null when no client has a parseable, non-future startDate — never a
   * fabricated 0. */
  averageTenureDays: number | null;
};

export function buildPortfolioComposition(clients: Client[], now: Date = new Date()): PortfolioComposition {
  const byStatusMap = new Map<ClientStatus, number>();
  const bySectorMap = new Map<string, number>();
  const byServiceMap = new Map<string, number>();
  let totalContractedMetaBudget = 0;
  let clientsWithBudget = 0;
  const tenureDays: number[] = [];

  for (const client of clients) {
    byStatusMap.set(client.status, (byStatusMap.get(client.status) ?? 0) + 1);

    const sector = client.sector.trim() || 'Sin sector';
    bySectorMap.set(sector, (bySectorMap.get(sector) ?? 0) + 1);

    const service = client.service.trim() || 'Sin servicio';
    byServiceMap.set(service, (byServiceMap.get(service) ?? 0) + 1);

    totalContractedMetaBudget += client.metaBudgetMonthly;
    if (client.metaBudgetMonthly > 0) clientsWithBudget += 1;

    const start = new Date(client.startDate);
    const days = (now.getTime() - start.getTime()) / 86_400_000;
    if (!Number.isNaN(start.getTime()) && days >= 0) tenureDays.push(days);
  }

  return {
    totalClients: clients.length,
    byStatus: [...byStatusMap.entries()].map(([status, count]) => ({ status, count })),
    bySector: [...bySectorMap.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    byService: [...byServiceMap.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    totalContractedMetaBudget,
    clientsWithBudget,
    averageTenureDays: tenureDays.length > 0 ? tenureDays.reduce((sum, d) => sum + d, 0) / tenureDays.length : null,
  };
}

// ===== 2. Commercial benchmarking =====
// All-time snapshot only (Analytics has no period selector — that stays
// Results' territory). CRITICAL: the portfolio benchmark is always derived
// from SUMMED totals across every client, never from averaging each client's
// own rate — averaging would weight a 2-lead client the same as a 200-lead
// client (the same principle lib/results.ts's aggregateResultsTotals already
// applies to ROAS/CAC).

export type FunnelRates = {
  qualificationRate: number | null;
  /** Leads → Appointments directly — distinct from lib/results.ts's
   * bookingRate (Qualified → Appointments). Named explicitly to avoid
   * confusion with that other, narrower rate. */
  leadToAppointmentRate: number | null;
  attendanceRate: number | null;
  closeRate: number | null;
};

function computeFunnelRates(counts: LeadFunnelCounts): FunnelRates {
  return {
    qualificationRate: rate(counts.qualified, counts.leads),
    leadToAppointmentRate: rate(counts.appointments, counts.leads),
    attendanceRate: rate(counts.attended, counts.appointments),
    closeRate: rate(counts.converted, counts.leads),
  };
}

/** One entry per client — cohort is that client's ENTIRE lead history (no
 * period bound), matching the all-time, cross-portfolio nature of Analytics. */
export function buildPerClientLeadFunnelCounts(
  clients: Pick<Client, 'id'>[],
  leads: Lead[],
  events: LeadEvent[],
): { clientId: string; counts: LeadFunnelCounts }[] {
  return clients.map((client) => ({
    clientId: client.id,
    counts: buildLeadFunnel(
      leads.filter((lead) => lead.clientId === client.id),
      events,
    ),
  }));
}

export type PortfolioBenchmark = FunnelRates & { totals: LeadFunnelCounts };

export function buildPortfolioBenchmark(perClientCounts: LeadFunnelCounts[]): PortfolioBenchmark {
  const totals = sumFunnelCounts(perClientCounts);
  return { totals, ...computeFunnelRates(totals) };
}

export type ClientBenchmarkRow = FunnelRates & {
  clientId: string;
  clientName: string;
  counts: LeadFunnelCounts;
};

export function buildClientBenchmarkRows(
  clients: { id: string; name: string }[],
  perClientCounts: { clientId: string; counts: LeadFunnelCounts }[],
): ClientBenchmarkRow[] {
  const byClientId = new Map(perClientCounts.map((entry) => [entry.clientId, entry.counts]));
  const emptyCounts: LeadFunnelCounts = { leads: 0, qualified: 0, appointments: 0, attended: 0, converted: 0 };

  return clients.map((client) => {
    const counts = byClientId.get(client.id) ?? emptyCounts;
    return { clientId: client.id, clientName: client.name, counts, ...computeFunnelRates(counts) };
  });
}

export const PORTFOLIO_BENCHMARK_NOTE =
  'La comparativa se calcula sobre el total agregado de la cartera. Con pocos clientes o pocos leads, la comparación es menos representativa: ganará precisión a medida que se acumulen más datos.';

// ===== 3. Acquisition quality =====

export type SourceAcquisitionRow = {
  source: string;
  leads: number;
  qualified: number;
  converted: number;
  qualificationRate: number | null;
  conversionRate: number | null;
};

/** Grouped by Lead.source (CRM, free-text) — never MetaCampaign.leads
 * (platform-side, lifetime-cumulative). These two lead counts must never be
 * summed or compared 1:1. Client-portfolio only: REKREATIVE's own
 * scope==='internal' leads are excluded — this is a client-portfolio
 * Analytics view, never a mix of REKREATIVE's own acquisition. */
export function buildAcquisitionBySource(leads: Lead[], events: LeadEvent[]): SourceAcquisitionRow[] {
  const clientLeads = leads.filter((lead) => lead.scope === 'client');
  const bySource = new Map<string, Lead[]>();
  for (const lead of clientLeads) {
    const key = lead.source.trim() || 'Sin origen';
    const list = bySource.get(key);
    if (list) list.push(lead);
    else bySource.set(key, [lead]);
  }

  return [...bySource.entries()]
    .map(([source, sourceLeads]) => {
      const counts = buildLeadFunnel(sourceLeads, events);
      return {
        source,
        leads: counts.leads,
        qualified: counts.qualified,
        converted: counts.converted,
        qualificationRate: rate(counts.qualified, counts.leads),
        conversionRate: rate(counts.converted, counts.leads),
      };
    })
    .sort((a, b) => b.leads - a.leads);
}

export type LeadIntentDistribution = {
  analyzed: number;
  unanalyzed: number;
  byIntent: { intent: LeadIntent; count: number }[];
  byPriority: { priority: LeadPriority; count: number }[];
};

/** "Analyzed" means an aiAnalysis record exists at all — unanalyzed leads are
 * reported as their own honest bucket, never guessed into an intent/priority
 * bucket. Client-portfolio only — see buildAcquisitionBySource. */
export function buildLeadIntentDistribution(leads: Lead[]): LeadIntentDistribution {
  const clientLeads = leads.filter((lead) => lead.scope === 'client');
  let analyzed = 0;
  const intentCounts = new Map<LeadIntent, number>();
  const priorityCounts = new Map<LeadPriority, number>();

  for (const lead of clientLeads) {
    if (!lead.aiAnalysis) continue;
    analyzed += 1;
    if (lead.aiAnalysis.intent) {
      intentCounts.set(lead.aiAnalysis.intent, (intentCounts.get(lead.aiAnalysis.intent) ?? 0) + 1);
    }
    if (lead.aiAnalysis.priority) {
      priorityCounts.set(lead.aiAnalysis.priority, (priorityCounts.get(lead.aiAnalysis.priority) ?? 0) + 1);
    }
  }

  return {
    analyzed,
    unanalyzed: clientLeads.length - analyzed,
    byIntent: [...intentCounts.entries()].map(([intent, count]) => ({ intent, count })),
    byPriority: [...priorityCounts.entries()].map(([priority, count]) => ({ priority, count })),
  };
}

// ===== 4. Operational infrastructure =====

// --- Automations ---

export type AutomationsOperationalSummary = {
  total: number;
  healthy: number;
  needsAttention: number;
  neverRun: number;
  runStats: AutomationRunStats;
  byPlatform: { platform: AutomationPlatform; count: number }[];
  byType: { type: AutomationType; count: number }[];
};

/** Client operational health only — REKREATIVE's own scope==='internal'
 * automations (and their runs) are excluded from this client-portfolio
 * summary. `runs` is filtered to only the runs belonging to a client-scoped
 * automation, so an internal automation's run history never inflates the
 * portfolio's success-rate/run-count either. */
export function buildAutomationsOperationalSummary(
  automations: Automation[],
  runs: AutomationRun[],
): AutomationsOperationalSummary {
  const clientAutomations = automations.filter((automation) => automation.scope === 'client');
  const clientAutomationIds = new Set(clientAutomations.map((automation) => automation.id));
  const clientRuns = runs.filter((run) => clientAutomationIds.has(run.automationId));

  let healthy = 0;
  let needsAttention = 0;
  let neverRun = 0;
  const platformCounts = new Map<AutomationPlatform, number>();
  const typeCounts = new Map<AutomationType, number>();

  for (const automation of clientAutomations) {
    const health = getAutomationHealth(automation);
    if (health === 'healthy') healthy += 1;
    else if (health === 'needs_attention') needsAttention += 1;
    else neverRun += 1;

    for (const platform of automation.platforms) {
      platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1);
    }
    typeCounts.set(automation.type, (typeCounts.get(automation.type) ?? 0) + 1);
  }

  return {
    total: clientAutomations.length,
    healthy,
    needsAttention,
    neverRun,
    runStats: getAutomationRunStats(clientRuns),
    byPlatform: [...platformCounts.entries()].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count),
    byType: [...typeCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
  };
}

// --- AI agents ("Configuración de agentes IA") ---
// Deliberately never labelled "ready"/"healthy"/"operational" — configuration
// completeness is a field-completeness fact, not an operational-readiness
// claim (see lib/agents-ai.ts's own comment on AiAgentConfigurationStatus).

export type AiAgentsConfigurationSummary = {
  total: number;
  active: number;
  paused: number;
  draft: number;
  configComplete: number;
  configIncomplete: number;
  byProvider: { provider: AiAgentProvider; count: number }[];
  byChannel: { channel: AiAgentChannel; count: number }[];
  byUseCase: { useCase: AiAgentUseCase; count: number }[];
};

/** Client portfolio configuration only — REKREATIVE's own scope==='internal'
 * agents are excluded from this summary. */
export function buildAiAgentsConfigurationSummary(agents: AiAgent[]): AiAgentsConfigurationSummary {
  const clientAgents = agents.filter((agent) => agent.scope === 'client');
  let active = 0;
  let paused = 0;
  let draft = 0;
  let configComplete = 0;
  let configIncomplete = 0;
  const providerCounts = new Map<AiAgentProvider, number>();
  const channelCounts = new Map<AiAgentChannel, number>();
  const useCaseCounts = new Map<AiAgentUseCase, number>();

  for (const agent of clientAgents) {
    if (agent.status === 'active') active += 1;
    else if (agent.status === 'paused') paused += 1;
    else draft += 1;

    if (getAiAgentConfigurationStatus(agent) === 'complete') configComplete += 1;
    else configIncomplete += 1;

    if (agent.provider) providerCounts.set(agent.provider, (providerCounts.get(agent.provider) ?? 0) + 1);
    if (agent.channel) channelCounts.set(agent.channel, (channelCounts.get(agent.channel) ?? 0) + 1);
    if (agent.useCase) useCaseCounts.set(agent.useCase, (useCaseCounts.get(agent.useCase) ?? 0) + 1);
  }

  return {
    total: clientAgents.length,
    active,
    paused,
    draft,
    configComplete,
    configIncomplete,
    byProvider: [...providerCounts.entries()].map(([provider, count]) => ({ provider, count })),
    byChannel: [...channelCounts.entries()].map(([channel, count]) => ({ channel, count })),
    byUseCase: [...useCaseCounts.entries()].map(([useCase, count]) => ({ useCase, count })),
  };
}

// --- Integrations (requirement-aware, not a raw connection count) ---

export type PortfolioIntegrationCoverage = {
  perClient: ClientOnboardingSummary[];
  totalRequired: number;
  totalRequiredConfigured: number;
  totalRequiredPending: number;
  totalRequiredIncomplete: number;
  /** Aggregated first — required-configured summed across every client,
   * divided by required summed across every client. Never an average of each
   * client's own progressPercent (same aggregation-first principle as
   * buildPortfolioBenchmark). Null when the portfolio has zero required rows. */
  coveragePercent: number | null;
  /** Verification is a separate axis from configuration coverage above —
   * "configured" never implies "verified". Raw connection-level counts,
   * portfolio-wide (both client-scoped and internal-shared), independent of
   * any client's requirement plan. */
  totalConnections: number;
  verifiedConnections: number;
  notVerifiedConnections: number;
  failedConnections: number;
};

export function buildPortfolioIntegrationCoverage(
  clients: Client[],
  allRequirements: ClientIntegrationRequirement[],
  allConnections: IntegrationConnection[],
): PortfolioIntegrationCoverage {
  const internalConnections = allConnections.filter((connection) => connection.scope === 'internal');

  const perClient = clients.map((client) => {
    const requirements = allRequirements.filter((requirement) => requirement.clientId === client.id);
    const ownConnections = allConnections.filter((connection) => connection.clientId === client.id);
    return summarizeClientOnboarding(client.id, requirements, [...ownConnections, ...internalConnections]);
  });

  const totals = perClient.reduce(
    (acc, summary) => ({
      totalRequired: acc.totalRequired + summary.requiredTotal,
      totalRequiredConfigured: acc.totalRequiredConfigured + summary.requiredConfigured,
      totalRequiredPending: acc.totalRequiredPending + summary.requiredPending,
      totalRequiredIncomplete: acc.totalRequiredIncomplete + summary.requiredIncomplete,
    }),
    { totalRequired: 0, totalRequiredConfigured: 0, totalRequiredPending: 0, totalRequiredIncomplete: 0 },
  );

  return {
    perClient,
    ...totals,
    coveragePercent: totals.totalRequired === 0 ? null : Math.round((totals.totalRequiredConfigured / totals.totalRequired) * 100),
    totalConnections: allConnections.length,
    verifiedConnections: allConnections.filter((connection) => connection.verificationStatus === 'verified').length,
    notVerifiedConnections: allConnections.filter((connection) => connection.verificationStatus === 'not_verified').length,
    failedConnections: allConnections.filter((connection) => connection.verificationStatus === 'failed').length,
  };
}

// ===== Campaign portfolio mix (supporting context only — no spend charts) =====

export type CampaignPortfolioMix = {
  total: number;
  byStatus: { status: MetaCampaignStatus; count: number }[];
  byObjective: { objective: MetaCampaignObjective; count: number }[];
};

/** Client campaign context only — REKREATIVE's own scope==='internal'
 * acquisition campaign is excluded. This section is deliberately
 * "contexto, sin gasto" for the client portfolio, never REKREATIVE's own
 * acquisition. */
export function buildCampaignPortfolioMix(campaigns: MetaCampaign[]): CampaignPortfolioMix {
  const clientCampaigns = campaigns.filter((campaign) => campaign.scope === 'client');
  const statusCounts = new Map<MetaCampaignStatus, number>();
  const objectiveCounts = new Map<MetaCampaignObjective, number>();

  for (const campaign of clientCampaigns) {
    statusCounts.set(campaign.status, (statusCounts.get(campaign.status) ?? 0) + 1);
    objectiveCounts.set(campaign.objective, (objectiveCounts.get(campaign.objective) ?? 0) + 1);
  }

  return {
    total: clientCampaigns.length,
    byStatus: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
    byObjective: [...objectiveCounts.entries()].map(([objective, count]) => ({ objective, count })),
  };
}

// ===== 5. Opportunities / Risks feed =====
// Deterministic, template-derived findings only — every message is built
// from a concrete stored fact (a count, a name, a status). No severity/
// urgency ranking is computed or implied; each finding states what is true,
// not how bad it is.

export type PortfolioFindingCategory =
  | 'meta_budget_no_campaign'
  | 'integration_requirement_pending'
  | 'automation_needs_attention'
  | 'automation_never_run'
  | 'agent_config_incomplete'
  | 'integration_verification_failed';

export type PortfolioFinding = {
  id: string;
  category: PortfolioFindingCategory;
  clientId: string | null;
  clientName: string | null;
  message: string;
};

export function buildOpportunitiesFeed(input: {
  clients: Client[];
  campaigns: MetaCampaign[];
  automations: Automation[];
  agents: AiAgent[];
  connections: IntegrationConnection[];
  requirements: ClientIntegrationRequirement[];
}): PortfolioFinding[] {
  const { clients, campaigns, automations, agents, connections, requirements } = input;
  const findings: PortfolioFinding[] = [];
  const nameOf = (clientId: string) => clients.find((client) => client.id === clientId)?.name ?? 'Cliente desconocido';
  const internalConnections = connections.filter((connection) => connection.scope === 'internal');

  // Contracted Meta budget with no active campaign.
  for (const client of clients) {
    if (client.metaBudgetMonthly <= 0) continue;
    const hasActiveCampaign = campaigns.some((campaign) => campaign.clientId === client.id && campaign.status === 'active');
    if (hasActiveCampaign) continue;
    findings.push({
      id: `budget-no-campaign-${client.id}`,
      category: 'meta_budget_no_campaign',
      clientId: client.id,
      clientName: client.name,
      message: `${client.name} tiene presupuesto mensual de Meta contratado pero ninguna campaña activa.`,
    });
  }

  // Required integrations still pending, per client.
  for (const client of clients) {
    const clientRequirements = requirements.filter((requirement) => requirement.clientId === client.id);
    const ownConnections = connections.filter((connection) => connection.clientId === client.id);
    const summary = summarizeClientOnboarding(client.id, clientRequirements, [...ownConnections, ...internalConnections]);
    if (summary.requiredPending === 0) continue;
    findings.push({
      id: `integration-pending-${client.id}`,
      category: 'integration_requirement_pending',
      clientId: client.id,
      clientName: client.name,
      message: `${client.name} tiene ${summary.requiredPending} integración(es) requerida(s) sin configurar.`,
    });
  }

  // Automations needing attention, or active but never run. Client-portfolio
  // findings only — REKREATIVE's own internal automations never generate a
  // client-portfolio risk, no matter their health.
  for (const automation of automations) {
    if (automation.scope === 'internal') continue;
    const health = getAutomationHealth(automation);
    const owner = nameOf(automation.clientId ?? '');
    if (health === 'needs_attention') {
      findings.push({
        id: `automation-attention-${automation.id}`,
        category: 'automation_needs_attention',
        clientId: automation.clientId,
        clientName: owner,
        message: `La automatización "${automation.name}" (${owner}) requiere atención: su última ejecución falló.`,
      });
    } else if (health === 'never_run' && automation.status === 'active') {
      findings.push({
        id: `automation-never-run-${automation.id}`,
        category: 'automation_never_run',
        clientId: automation.clientId,
        clientName: owner,
        message: `La automatización "${automation.name}" (${owner}) está activa pero no registra ninguna ejecución.`,
      });
    }
  }

  // Active AI agents with incomplete configuration (draft agents are
  // expected to be incomplete while being set up — not flagged).
  // Client-portfolio findings only — REKREATIVE's own internal agents never
  // generate a client-portfolio risk.
  for (const agent of agents) {
    if (agent.scope === 'internal') continue;
    if (agent.status !== 'active') continue;
    if (getAiAgentConfigurationStatus(agent) !== 'incomplete') continue;
    const owner = nameOf(agent.clientId ?? '');
    findings.push({
      id: `agent-incomplete-${agent.id}`,
      category: 'agent_config_incomplete',
      clientId: agent.clientId,
      clientName: owner,
      message: `El agente de IA "${agent.name}" (${owner}) está activo con configuración incompleta.`,
    });
  }

  // Connections with a failed verification. Client-owned connections only —
  // a REKREATIVE-internal shared connection's own verification issue is
  // REKREATIVE's own operational risk, not a client-portfolio one; it can
  // still surface for a client, but only through the existing valid
  // requirement-satisfaction path above (integration_requirement_pending),
  // never as its own standalone "internal connection failed" finding here.
  for (const connection of connections) {
    if (connection.scope === 'internal') continue;
    if (connection.verificationStatus !== 'failed') continue;
    const owner = nameOf(connection.clientId ?? '');
    findings.push({
      id: `connection-failed-${connection.id}`,
      category: 'integration_verification_failed',
      clientId: connection.clientId,
      clientName: owner,
      message: `La conexión "${connection.name}" (${owner}) tiene una incidencia de verificación.`,
    });
  }

  return findings;
}

// ===== Demo data detection =====
// Only MetaCampaign/Automation/AiAgent/IntegrationConnection carry a
// dataSource field among the sources Analytics touches — Client and Lead do
// not (same documented limitation as lib/results.ts's includesDemoData).
//
// Campaigns/automations/agents are checked client-scope only, matching what
// this module actually renders for the client portfolio — a demo-sourced
// REKREATIVE-internal record (excluded from every metric above) must never
// be the sole reason this badge shows. Connections are deliberately left
// unfiltered: internal/shared connections DO still visibly affect the
// Integraciones section (verification counts, onboarding coverage via the
// shared-connection exception), so their demo-ness is honestly "used by
// Analytics" here too.
export function includesDemoPortfolioData(input: {
  campaigns?: MetaCampaign[];
  automations?: Automation[];
  agents?: AiAgent[];
  connections?: IntegrationConnection[];
}): boolean {
  return (
    (input.campaigns ?? []).some((campaign) => campaign.scope === 'client' && campaign.dataSource === 'demo') ||
    (input.automations ?? []).some((automation) => automation.scope === 'client' && automation.dataSource === 'demo') ||
    (input.agents ?? []).some((agent) => agent.scope === 'client' && agent.dataSource === 'demo') ||
    (input.connections ?? []).some((connection) => connection.dataSource === 'demo')
  );
}

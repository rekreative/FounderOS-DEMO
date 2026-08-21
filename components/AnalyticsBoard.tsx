'use client';

import { useEffect, useMemo, useState } from 'react';
import { getClientStatusLabel, getClients, initializeStoreIfNeeded, type Client } from '@/lib/clients';
import { getLeadEvents, getLeads, initializeLeadsStoreIfNeeded, type Lead, type LeadEvent, type LeadIntent, type LeadPriority } from '@/lib/leads';
import {
  getCampaigns,
  getObjectiveLabel as getCampaignObjectiveLabel,
  getStatusLabel as getCampaignStatusLabel,
  initializeMetaCampaignsStoreIfNeeded,
  type MetaCampaign,
} from '@/lib/meta-ads';
import {
  getAutomationRuns,
  getAutomations,
  getHealthLabel as getAutomationHealthLabel,
  getPlatformLabel as getAutomationPlatformLabel,
  getTypeLabel as getAutomationTypeLabel,
  initializeAutomationsStoreIfNeeded,
  type Automation,
  type AutomationRun,
} from '@/lib/automations';
import {
  getAiAgentChannelLabel,
  getAiAgentProviderLabel,
  getAiAgentUseCaseLabel,
  getAiAgents,
  initializeAiAgentsStoreIfNeeded,
  type AiAgent,
} from '@/lib/agents-ai';
import {
  getIntegrationConnections,
  initializeIntegrationConnectionsStoreIfNeeded,
  type IntegrationConnection,
} from '@/lib/integration-connections';
import {
  getClientIntegrationRequirements,
  initializeClientIntegrationRequirementsStoreIfNeeded,
  type ClientIntegrationRequirement,
} from '@/lib/client-integration-requirements';
import { formatEUR, formatRate, groupLeadsByPeriod, resolveTrendGranularity } from '@/lib/results';
import {
  buildAcquisitionBySource,
  buildAiAgentsConfigurationSummary,
  buildAutomationsOperationalSummary,
  buildCampaignPortfolioMix,
  buildClientBenchmarkRows,
  buildLeadIntentDistribution,
  buildOpportunitiesFeed,
  buildPerClientLeadFunnelCounts,
  buildPortfolioBenchmark,
  buildPortfolioComposition,
  buildPortfolioIntegrationCoverage,
  includesDemoPortfolioData,
  PORTFOLIO_BENCHMARK_NOTE,
} from '@/lib/analytics-portfolio';
import { PageHeader } from '@/components/PageHeader';
import { SectionHead } from '@/components/terminal';
import { BarListChart, BarSeriesChart, DemoDataBadge, SparseTrendState } from '@/components/ResultsCharts';
import {
  AnalyticsSectionHead,
  BenchmarkTable,
  CoverageMeter,
  FindingsList,
  GroupPanel,
  HonestNote,
  SourceAcquisitionTable,
  StatTile,
} from '@/components/AnalyticsCharts';

const INTENT_LABEL: Record<LeadIntent, string> = { hot: 'Caliente', warm: 'Tibio', cold: 'Frío' };
const PRIORITY_LABEL: Record<LeadPriority, string> = { high: 'Alta', medium: 'Media', low: 'Baja' };

function formatTenure(days: number | null): string {
  if (days == null) return '—';
  if (days < 60) return `${Math.round(days)} días`;
  return `${Math.round(days / 30)} meses`;
}

const fmtCount = (value: number) => String(value);

/** REKREATIVE Analítica — cross-portfolio patterns, strengths, weaknesses and
 * operational gaps across every client. Deliberately independent of
 * ResultsBoard: reads each domain module's own store directly (same pattern
 * ResultsBoard itself uses), and never recomputes anything Results already
 * owns (attributed revenue, ROAS, CAC, period-scoped ad performance, the
 * Results funnel dashboard, Meta vs CRM comparison). */
export function AnalyticsBoard() {
  const [clients, setClients] = useState<Client[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [requirements, setRequirements] = useState<ClientIntegrationRequirement[]>([]);

  useEffect(() => {
    initializeStoreIfNeeded();
    initializeLeadsStoreIfNeeded();
    initializeMetaCampaignsStoreIfNeeded();
    initializeAutomationsStoreIfNeeded();
    initializeAiAgentsStoreIfNeeded();
    initializeIntegrationConnectionsStoreIfNeeded();
    initializeClientIntegrationRequirementsStoreIfNeeded();

    setClients(getClients());

    const loadedLeads = getLeads();
    setLeads(loadedLeads);
    setEvents(loadedLeads.flatMap((lead) => getLeadEvents(lead.id)));

    setCampaigns(getCampaigns());

    const loadedAutomations = getAutomations();
    setAutomations(loadedAutomations);
    setAutomationRuns(loadedAutomations.flatMap((automation) => getAutomationRuns(automation.id)));

    setAgents(getAiAgents());
    setConnections(getIntegrationConnections());
    setRequirements(getClientIntegrationRequirements());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 1. Portfolio composition ----
  const composition = useMemo(() => buildPortfolioComposition(clients), [clients]);
  const campaignMix = useMemo(() => buildCampaignPortfolioMix(campaigns), [campaigns]);

  // ---- 2. Commercial benchmarking (all-time — Analytics has no period selector) ----
  const perClientCounts = useMemo(() => buildPerClientLeadFunnelCounts(clients, leads, events), [clients, leads, events]);
  const benchmark = useMemo(() => buildPortfolioBenchmark(perClientCounts.map((c) => c.counts)), [perClientCounts]);
  const benchmarkRows = useMemo(
    () => buildClientBenchmarkRows(clients.map((c) => ({ id: c.id, name: c.name })), perClientCounts),
    [clients, perClientCounts],
  );

  // ---- 3. Acquisition quality ----
  // buildAcquisitionBySource/buildLeadIntentDistribution already filter to
  // scope==='client' internally. groupLeadsByPeriod (lib/results.ts) is a
  // shared utility with no scope concept of its own, so the client-only
  // filter for the lead-volume trend happens here instead, at this one call
  // site — REKREATIVE's own internal leads must never appear in a
  // client-portfolio trend chart.
  const acquisitionBySource = useMemo(() => buildAcquisitionBySource(leads, events), [leads, events]);
  const intentDistribution = useMemo(() => buildLeadIntentDistribution(leads), [leads]);
  const clientLeads = useMemo(() => leads.filter((lead) => lead.scope === 'client'), [leads]);
  const trendGranularity = resolveTrendGranularity('all', { start: null, end: null });
  const leadTrend = useMemo(() => groupLeadsByPeriod(clientLeads, trendGranularity), [clientLeads, trendGranularity]);
  const nonZeroTrendPoints = leadTrend.filter((point) => point.value > 0).length;

  // ---- 4. Operational infrastructure ----
  const automationsSummary = useMemo(
    () => buildAutomationsOperationalSummary(automations, automationRuns),
    [automations, automationRuns],
  );
  const agentsSummary = useMemo(() => buildAiAgentsConfigurationSummary(agents), [agents]);
  const integrationCoverage = useMemo(
    () => buildPortfolioIntegrationCoverage(clients, requirements, connections),
    [clients, requirements, connections],
  );

  // ---- 5. Opportunities / risks ----
  const findings = useMemo(
    () => buildOpportunitiesFeed({ clients, campaigns, automations, agents, connections, requirements }),
    [clients, campaigns, automations, agents, connections, requirements],
  );

  const showDemoBadge = includesDemoPortfolioData({ campaigns, automations, agents, connections });

  const statusRows = composition.byStatus.map((row) => ({ key: row.status, label: getClientStatusLabel(row.status), value: row.count }));
  const sectorRows = composition.bySector.map((row) => ({ key: row.key, label: row.key, value: row.count }));
  const serviceRows = composition.byService.map((row) => ({ key: row.key, label: row.key, value: row.count }));
  const campaignStatusRows = campaignMix.byStatus.map((row) => ({ key: row.status, label: getCampaignStatusLabel(row.status), value: row.count }));
  const campaignObjectiveRows = campaignMix.byObjective.map((row) => ({ key: row.objective, label: getCampaignObjectiveLabel(row.objective), value: row.count }));
  const intentRows = intentDistribution.byIntent.map((row) => ({ key: row.intent, label: INTENT_LABEL[row.intent], value: row.count }));
  const priorityRows = intentDistribution.byPriority.map((row) => ({ key: row.priority, label: PRIORITY_LABEL[row.priority], value: row.count }));
  const automationPlatformRows = automationsSummary.byPlatform.map((row) => ({ key: row.platform, label: getAutomationPlatformLabel(row.platform), value: row.count }));
  const automationTypeRows = automationsSummary.byType.map((row) => ({ key: row.type, label: getAutomationTypeLabel(row.type), value: row.count }));
  const agentProviderRows = agentsSummary.byProvider.map((row) => ({ key: row.provider, label: getAiAgentProviderLabel(row.provider), value: row.count }));
  const agentChannelRows = agentsSummary.byChannel.map((row) => ({ key: row.channel, label: getAiAgentChannelLabel(row.channel), value: row.count }));
  const agentUseCaseRows = agentsSummary.byUseCase.map((row) => ({ key: row.useCase, label: getAiAgentUseCaseLabel(row.useCase), value: row.count }));

  return (
    <div className="p-4">
      <div className="mx-auto w-full max-w-[1680px]">
        <PageHeader
          eyebrow="REKREATIVE OPERACIONES"
          title="Analítica"
          right={showDemoBadge ? <DemoDataBadge /> : undefined}
        />
        <p className="-mt-4 mb-8 max-w-2xl text-[12px] text-os-muted">
          Patrones, fortalezas, debilidades y huecos operativos en la cartera de clientes de REKREATIVE. Complementa a
          Resultados — no repite ingresos, ROAS, CAC ni el rendimiento publicitario por periodo.
        </p>

        {/* ===== 1. Cartera ===== */}
        <section className="mb-12">
          <AnalyticsSectionHead title="Cartera" subtitle={`${composition.totalClients} clientes`} />
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatTile label="Total clientes" value={String(composition.totalClients)} />
            <StatTile label="Presupuesto Meta contratado" value={formatEUR(composition.totalContractedMetaBudget)} hint="mensual, suma de cartera" />
            <StatTile label="Clientes con presupuesto" value={String(composition.clientsWithBudget)} />
            <StatTile label="Antigüedad media" value={formatTenure(composition.averageTenureDays)} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="border border-os-border bg-os-surface p-4">
              <SectionHead label="Por estado" />
              <BarListChart rows={statusRows} formatValue={fmtCount} />
            </div>
            <div className="border border-os-border bg-os-surface p-4">
              <SectionHead label="Por sector" />
              <BarListChart rows={sectorRows} formatValue={fmtCount} />
            </div>
            <div className="border border-os-border bg-os-surface p-4">
              <SectionHead label="Por servicio" />
              <BarListChart rows={serviceRows} formatValue={fmtCount} />
            </div>
          </div>
          {campaignMix.total > 0 && (
            <div className="mt-4">
              <GroupPanel title="Campañas Meta" subtitle="contexto, sin gasto" muted>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-os-dim">Por estado</div>
                    <BarListChart rows={campaignStatusRows} formatValue={fmtCount} />
                  </div>
                  <div>
                    <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-os-dim">Por objetivo</div>
                    <BarListChart rows={campaignObjectiveRows} formatValue={fmtCount} />
                  </div>
                </div>
              </GroupPanel>
            </div>
          )}
        </section>

        {/* ===== 2. Comparativa comercial ===== */}
        <section className="mb-12">
          <AnalyticsSectionHead title="Comparativa comercial" subtitle="funnel CRM, todo el histórico" />
          <div className="mb-3">
            <HonestNote>{PORTFOLIO_BENCHMARK_NOTE}</HonestNote>
          </div>
          <div className="border border-os-border bg-os-surface p-4">
            <BenchmarkTable rows={benchmarkRows} benchmark={benchmark} />
          </div>
        </section>

        {/* ===== 3. Calidad de adquisición ===== */}
        <section className="mb-12">
          <AnalyticsSectionHead title="Calidad de adquisición" subtitle="leads CRM, no leads de Meta" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <GroupPanel title="Rendimiento por origen (CRM)" subtitle={`${acquisitionBySource.length} orígenes`}>
              <SourceAcquisitionTable rows={acquisitionBySource} />
              <div>
                <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-os-dim">Volumen de leads CRM · tendencia</div>
                {nonZeroTrendPoints < 2 ? (
                  <SparseTrendState points={leadTrend} granularity={trendGranularity} formatValue={fmtCount} />
                ) : (
                  <BarSeriesChart points={leadTrend} granularity={trendGranularity} formatValue={fmtCount} />
                )}
              </div>
            </GroupPanel>
            <GroupPanel title="Análisis de IA" subtitle={`${intentDistribution.analyzed} analizados · ${intentDistribution.unanalyzed} sin analizar`}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-os-dim">Intención</div>
                  <BarListChart rows={intentRows} formatValue={fmtCount} emptyLabel="Sin leads analizados por IA todavía." />
                </div>
                <div>
                  <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-os-dim">Prioridad</div>
                  <BarListChart rows={priorityRows} formatValue={fmtCount} emptyLabel="Sin leads analizados por IA todavía." />
                </div>
              </div>
            </GroupPanel>
          </div>
        </section>

        {/* ===== 4. Infraestructura operativa ===== */}
        <section className="mb-12">
          <AnalyticsSectionHead title="Infraestructura operativa" />
          <div className="flex flex-col gap-4">
            <GroupPanel title="Automatizaciones">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <StatTile label={getAutomationHealthLabel('healthy')} value={String(automationsSummary.healthy)} />
                <StatTile label={getAutomationHealthLabel('needs_attention')} value={String(automationsSummary.needsAttention)} />
                <StatTile label={getAutomationHealthLabel('never_run')} value={String(automationsSummary.neverRun)} />
                <StatTile
                  label="Tasa de éxito de ejecuciones"
                  value={formatRate(automationsSummary.runStats.successRate)}
                  hint={automationsSummary.runStats.totalRuns > 0 ? `${automationsSummary.runStats.totalRuns} ejecuciones registradas` : 'Sin ejecuciones registradas'}
                />
              </div>
              {(automationPlatformRows.length > 1 || automationTypeRows.length > 1) && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {automationPlatformRows.length > 1 && (
                    <div className="border border-os-border bg-os-surface p-4">
                      <SectionHead label="Por plataforma" />
                      <BarListChart rows={automationPlatformRows} formatValue={fmtCount} />
                    </div>
                  )}
                  {automationTypeRows.length > 1 && (
                    <div className="border border-os-border bg-os-surface p-4">
                      <SectionHead label="Por tipo" />
                      <BarListChart rows={automationTypeRows} formatValue={fmtCount} />
                    </div>
                  )}
                </div>
              )}
            </GroupPanel>

            <GroupPanel title="Configuración de agentes IA">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                <StatTile label="Activos" value={String(agentsSummary.active)} />
                <StatTile label="Pausados" value={String(agentsSummary.paused)} />
                <StatTile label="Borrador" value={String(agentsSummary.draft)} />
                <StatTile label="Configuración completa" value={String(agentsSummary.configComplete)} />
                <StatTile label="Configuración incompleta" value={String(agentsSummary.configIncomplete)} />
              </div>
              {(agentProviderRows.length > 1 || agentChannelRows.length > 1 || agentUseCaseRows.length > 1) && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  {agentProviderRows.length > 1 && (
                    <div className="border border-os-border bg-os-surface p-4">
                      <SectionHead label="Por proveedor" />
                      <BarListChart rows={agentProviderRows} formatValue={fmtCount} />
                    </div>
                  )}
                  {agentChannelRows.length > 1 && (
                    <div className="border border-os-border bg-os-surface p-4">
                      <SectionHead label="Por canal" />
                      <BarListChart rows={agentChannelRows} formatValue={fmtCount} />
                    </div>
                  )}
                  {agentUseCaseRows.length > 1 && (
                    <div className="border border-os-border bg-os-surface p-4">
                      <SectionHead label="Por caso de uso" />
                      <BarListChart rows={agentUseCaseRows} formatValue={fmtCount} />
                    </div>
                  )}
                </div>
              )}
            </GroupPanel>

            <GroupPanel title="Integraciones">
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
                <CoverageMeter
                  label="Cobertura técnica requerida"
                  percent={integrationCoverage.coveragePercent}
                  hint={
                    integrationCoverage.totalRequired === 0
                      ? 'Sin integraciones requeridas definidas'
                      : `${integrationCoverage.totalRequiredConfigured} / ${integrationCoverage.totalRequired} requeridas configuradas`
                  }
                />
                <StatTile label="Verificadas" value={String(integrationCoverage.verifiedConnections)} hint={`de ${integrationCoverage.totalConnections} conexiones`} />
                <StatTile label="No verificadas" value={String(integrationCoverage.notVerifiedConnections)} />
                <StatTile label="Incidencias de verificación" value={String(integrationCoverage.failedConnections)} />
              </div>
              <HonestNote>
                Configurada no implica verificada — la cobertura mide onboarding técnico (integraciones requeridas por
                cliente, vía el plan de requisitos); verificada/no verificada/incidencia es un estado registrado por
                separado y nunca se combinan en un mismo porcentaje.
              </HonestNote>
            </GroupPanel>
          </div>
        </section>

        {/* ===== 5. Oportunidades / Riesgos ===== */}
        <section>
          <AnalyticsSectionHead title="Oportunidades y riesgos" subtitle={`${findings.length} hallazgos`} />
          <FindingsList findings={findings} />
        </section>
      </div>
    </div>
  );
}

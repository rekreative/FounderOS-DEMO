'use client';

import { useEffect, useMemo, useState } from 'react';
import { getClientStatusLabel } from '@/lib/clients';
import { useClientsRegistry } from '@/components/ClientsProvider';
import type { LeadIntent, LeadPriority } from '@/lib/leads';
import { getLeadEvents, getLeads, type Lead, type LeadEvent } from '@/lib/api/leads';
import { groupLeadsByPeriod, resolveTrendGranularity } from '@/lib/results';
import {
  buildAcquisitionBySource,
  buildClientBenchmarkRows,
  buildLeadIntentDistribution,
  buildPerClientLeadFunnelCounts,
  buildPortfolioBenchmark,
  buildPortfolioComposition,
  PORTFOLIO_BENCHMARK_NOTE,
} from '@/lib/analytics-portfolio';
import { PageHeader } from '@/components/PageHeader';
import { SectionHead } from '@/components/terminal';
import { BarListChart, BarSeriesChart, SparseTrendState } from '@/components/ResultsCharts';
import {
  AnalyticsSectionHead,
  BenchmarkTable,
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

/**
 * REKREATIVE Analítica V1 — cross-portfolio CRM patterns, real PostgreSQL
 * only (Clients + Leads + LeadEvents). Analytics V1 is scoped to
 * full-history views ONLY — no period selector, no Meta spend/CAC/ROAS
 * (that stays Results' territory for a selected period). Operational-infra
 * sections (Automations/AI agents/Integrations) and the legacy Meta
 * campaign store, plus the findings feed built on top of them, are
 * deliberately NOT rendered here: those stores are demo/manual-seeded with
 * no dataSource split in their aggregation, so presenting them as
 * operational Analytics would be dishonest. The underlying pure functions
 * for all of that (lib/analytics-portfolio.ts) are left intact and
 * isolated, not deleted — see that file's own exports for what Analytics V2
 * can reconnect once real Meta daily trends and live operational telemetry
 * exist.
 */
export function AnalyticsBoard() {
  // Canonical PostgreSQL registry — same source /clients and /leads read.
  const { clients, error: clientsError } = useClientsRegistry();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [leadsError, setLeadsError] = useState<string | null>(null);

  // Leads + their events: PostgreSQL, async, cancellation-guarded. Internal
  // REKREATIVE leads must never leak into client-portfolio Analytics — every
  // buildXxx() below that needs client-only leads already filters by
  // lead.scope/clientId (unchanged), so fetching the full set here (both
  // scopes) and letting those pure functions filter is correct.
  useEffect(() => {
    let cancelled = false;
    getLeads()
      .then(async (loadedLeads) => {
        if (cancelled) return;
        setLeads(loadedLeads);
        const eventLists = await Promise.all(loadedLeads.map((lead) => getLeadEvents(lead.id)));
        if (!cancelled) setEvents(eventLists.flat());
      })
      .catch((error: unknown) => {
        if (!cancelled) setLeadsError(error instanceof Error ? error.message : 'No se pudieron cargar los leads.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- 1. Portfolio composition ----
  const composition = useMemo(() => buildPortfolioComposition(clients), [clients]);

  // ---- 2. Commercial benchmarking (all-time — Analytics V1 has no period selector) ----
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

  const statusRows = composition.byStatus.map((row) => ({ key: row.status, label: getClientStatusLabel(row.status), value: row.count }));
  const sectorRows = composition.bySector.map((row) => ({ key: row.key, label: row.key, value: row.count }));
  const serviceRows = composition.byService.map((row) => ({ key: row.key, label: row.key, value: row.count }));
  const intentRows = intentDistribution.byIntent.map((row) => ({ key: row.intent, label: INTENT_LABEL[row.intent], value: row.count }));
  const priorityRows = intentDistribution.byPriority.map((row) => ({ key: row.priority, label: PRIORITY_LABEL[row.priority], value: row.count }));

  return (
    <div className="p-4">
      <div className="mx-auto w-full max-w-[1680px]">
        <PageHeader eyebrow="REKREATIVE OPERACIONES" title="Analítica" />
        <p className="-mt-4 mb-3 max-w-2xl text-[12px] text-os-muted">
          Patrones y calidad de adquisición en la cartera de clientes de REKREATIVE. Complementa a Resultados — no
          repite ingresos, ROAS, CAC ni el rendimiento publicitario por periodo.
        </p>
        <div className="mb-8 max-w-2xl">
          <HonestNote>
            TODO EL HISTÓRICO — datos acumulados desde el inicio, sin selector de periodo. Estas cifras no
            representan &quot;este mes&quot;, &quot;últimos 30 días&quot; ni el periodo seleccionado en Resultados.
          </HonestNote>
        </div>

        {(clientsError || leadsError) && (
          <div className="mb-8 border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">
            {clientsError ?? leadsError}
          </div>
        )}

        {/* ===== 1. Cartera ===== */}
        <section className="mb-12">
          <AnalyticsSectionHead title="Cartera" subtitle={`${composition.totalClients} clientes`} />
          {/* The two Meta-budget KPI tiles were removed from operational
              rendering — Client.metaBudgetMonthly is canonical PostgreSQL but
              its provenance isn't verifiable (seed rows copied the old demo
              constants verbatim, no dataSource marker exists to tell a
              confirmed-real budget from an untouched seed value). See
              buildPortfolioComposition in lib/analytics-portfolio.ts, left
              intact for reuse once that's resolved. */}
          <div className="mb-4 grid grid-cols-2 gap-2.5">
            <StatTile label="Total clientes" value={String(composition.totalClients)} />
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
        </section>

        {/* ===== 2. Comparativa comercial ===== */}
        <section className="mb-12">
          <AnalyticsSectionHead title="Comparativa comercial" subtitle="funnel CRM · todo el histórico" />
          <div className="mb-3">
            <HonestNote>{PORTFOLIO_BENCHMARK_NOTE}</HonestNote>
          </div>
          <div className="border border-os-border bg-os-surface p-4">
            <BenchmarkTable rows={benchmarkRows} benchmark={benchmark} />
          </div>
        </section>

        {/* ===== 3. Calidad de adquisición ===== */}
        <section>
          <AnalyticsSectionHead title="Calidad de adquisición" subtitle="leads CRM · todo el histórico · no leads de Meta" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <GroupPanel title="Rendimiento por origen (CRM)" subtitle={`${acquisitionBySource.length} orígenes`}>
              <SourceAcquisitionTable rows={acquisitionBySource} />
              <div>
                <div className="mb-2 font-mono text-[9px] uppercase tracking-[0.12em] text-os-dim">Volumen de leads CRM · todo el histórico</div>
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
      </div>
    </div>
  );
}

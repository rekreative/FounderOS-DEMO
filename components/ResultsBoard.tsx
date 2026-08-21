'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useClientsRegistry } from '@/components/ClientsProvider';
import { getLeadEvents, getLeads, type Lead, type LeadEvent } from '@/lib/api/leads';
import { getCampaigns, initializeMetaCampaignsStoreIfNeeded, type MetaCampaign } from '@/lib/meta-ads';
import {
  PERIOD_PRESET_OPTIONS,
  aggregateResultsTotals,
  buildClientComparison,
  buildFunnelStages,
  computeClientResults,
  formatEUR,
  formatRoas,
  getAdSpendUnavailableNote,
  getRevenueRecords,
  getStoredPeriodPreference,
  includesDemoData,
  initializeResultsStoreIfNeeded,
  resolvePeriod,
  setStoredPeriodPreference,
  sumFunnelCounts,
  type PeriodPreset,
  type RevenueRecord,
} from '@/lib/results';
import { SectionHead } from '@/components/terminal';
import { PageHeader } from '@/components/PageHeader';
import { BarListChart, DemoDataBadge, FunnelBars, ResultsKpiStrip } from '@/components/ResultsCharts';

/** REKREATIVE Resultados — the executive portfolio overview. Selecting a
 * client navigates to its dedicated /clients/[clientId]/results dashboard;
 * this page never swaps into a per-client detail mode itself. */
export function ResultsBoard() {
  // Canonical PostgreSQL registry — same source /clients and /leads read.
  const { clients, error: clientsError } = useClientsRegistry();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [revenueRecords, setRevenueRecords] = useState<RevenueRecord[]>([]);

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });

  // Leads + their events: PostgreSQL, async, cancellation-guarded.
  // computeClientResults filters by lead.clientId === client.id (unchanged),
  // so REKREATIVE's own internal leads (clientId null) never match any real
  // client and never leak into this client-only portfolio view.
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

  useEffect(() => {
    initializeMetaCampaignsStoreIfNeeded();
    initializeResultsStoreIfNeeded();

    setCampaigns(getCampaigns());
    setRevenueRecords(getRevenueRecords());

    // Restore the last-viewed period (shared with /clients/[clientId]/results)
    // so a refresh (F5) or a return visit doesn't silently reset to "Todo".
    const preference = getStoredPeriodPreference();
    setPeriodPreset(preference.preset);
    if (preference.preset === 'custom') {
      setCustomRange({ start: preference.start ?? '', end: preference.end ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setStoredPeriodPreference({
      preset: periodPreset,
      start: periodPreset === 'custom' ? customRange.start || null : null,
      end: periodPreset === 'custom' ? customRange.end || null : null,
    });
  }, [periodPreset, customRange]);

  const period = useMemo(
    () => resolvePeriod(periodPreset, periodPreset === 'custom' ? customRange : undefined),
    [periodPreset, customRange],
  );

  const perClient = useMemo(
    () => clients.map((client) => computeClientResults(client.id, leads, events, campaigns, revenueRecords, period, periodPreset)),
    [clients, leads, events, campaigns, revenueRecords, period, periodPreset],
  );

  const aggregate = useMemo(
    () =>
      aggregateResultsTotals(
        perClient.map((c) => ({
          adSpend: c.adSpend,
          crmLeads: c.counts.leads,
          converted: c.counts.converted,
          attributedRevenue: c.attributedRevenue,
        })),
      ),
    [perClient],
  );

  const globalFunnelStages = useMemo(
    () => buildFunnelStages(sumFunnelCounts(perClient.map((c) => c.counts))),
    [perClient],
  );

  const comparison = useMemo(
    () => buildClientComparison(clients.map((c) => ({ id: c.id, name: c.name })), perClient),
    [clients, perClient],
  );

  const revenueByClient = useMemo(
    () => comparison.map((row) => ({ key: row.clientId, label: row.clientName, value: row.attributedRevenue })),
    [comparison],
  );
  const leadsByClient = useMemo(
    () => comparison.map((row) => ({ key: row.clientId, label: row.clientName, value: row.crmLeads })).sort((a, b) => b.value - a.value),
    [comparison],
  );

  const showDemoBadge = includesDemoData({ revenueRecords, campaigns });
  const spendUnavailable = periodPreset !== 'all';

  return (
    <div className="p-4">
      <PageHeader eyebrow="REKREATIVE OPERACIONES" title="Resultados" />
      <div className="-mt-4 mb-5 flex flex-wrap items-center gap-2.5">
        <p className="max-w-2xl text-[12px] text-os-muted">
          Visión global del rendimiento comercial y financiero generado para los clientes de REKREATIVE.
        </p>
        {showDemoBadge && <DemoDataBadge />}
      </div>

      {(clientsError || leadsError) && (
        <div className="mb-5 border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">
          {clientsError ?? leadsError}
        </div>
      )}

      {/* Period controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {PERIOD_PRESET_OPTIONS.map((option) => {
            const active = periodPreset === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setPeriodPreset(option.id)}
                className={`border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide ${
                  active
                    ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent'
                    : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-muted'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {periodPreset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customRange.start}
              onChange={(event) => setCustomRange((prev) => ({ ...prev, start: event.target.value }))}
              className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] text-os-text"
            />
            <span className="text-os-dim">—</span>
            <input
              type="date"
              value={customRange.end}
              onChange={(event) => setCustomRange((prev) => ({ ...prev, end: event.target.value }))}
              className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] text-os-text"
            />
          </div>
        )}
      </div>

      {spendUnavailable && (
        <div className="mb-5 border border-dashed border-os-border bg-os-surface2 px-3 py-2 font-mono text-[10px] text-os-dim">
          {getAdSpendUnavailableNote()}
        </div>
      )}

      {/* Global KPI strip */}
      <div className="mb-6">
        <ResultsKpiStrip
          values={{
            adSpend: aggregate.adSpend,
            crmLeads: aggregate.crmLeads,
            converted: aggregate.converted,
            attributedRevenue: aggregate.attributedRevenue,
            roas: aggregate.roas,
            cac: aggregate.cac,
          }}
        />
      </div>

      {/* Visual portfolio summary — funnel + two client-comparison bars.
          Deliberately capped at three visualizations so the executive
          overview stays a summary, not another dense operational table. */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="border border-os-border bg-os-surface p-4">
          {/* "Hitos comerciales" (milestones), not a strict sequential
              funnel: these are summed across every client's own cohort, so
              e.g. "Asistidas" and "Conversiones" are independent axes (see
              lib/results.ts's buildLeadFunnel) that can make a later
              milestone exceed an earlier one — an adjacent-stage percentage
              here could render an impossible rate like "200%". Counts stay
              fully visible; only the misleading rate labels are omitted
              (showRates={false}). Per-client dashboards keep their existing
              funnel + rates unchanged (a single client's own cohort makes
              that framing legitimate there). */}
          <SectionHead label="Hitos comerciales · clientes" />
          <FunnelBars stages={globalFunnelStages} showRates={false} />
        </div>
        <div className="flex flex-col gap-4">
          <div className="border border-os-border bg-os-surface p-4">
            <SectionHead label="Ingresos atribuidos por cliente" />
            <BarListChart rows={revenueByClient} formatValue={formatEUR} emptyLabel="Sin ingresos atribuidos todavía." />
          </div>
          <div className="border border-os-border bg-os-surface p-4">
            <SectionHead label="Leads CRM por cliente" />
            <BarListChart rows={leadsByClient} formatValue={(value) => String(value)} emptyLabel="Sin leads todavía." />
          </div>
        </div>
      </div>

      {/* Client portfolio — each card links to its dedicated dashboard. */}
      <div>
        <SectionHead label="Clientes" count={clients.length} />
        {clients.length === 0 ? (
          <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
            No hay clientes todavía.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {comparison.map((row) => (
              <div key={row.clientId} className="flex flex-col justify-between border border-os-border bg-os-surface p-4">
                <div>
                  <div className="truncate text-[14px] font-semibold leading-tight text-os-text">{row.clientName}</div>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                    <div>
                      <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-os-dim">Gasto</div>
                      <div className="mt-0.5 font-mono text-[13px] text-os-text">{row.adSpend == null ? '—' : formatEUR(row.adSpend)}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-os-dim">Leads CRM</div>
                      <div className="mt-0.5 font-mono text-[13px] text-os-text">{row.crmLeads}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-os-dim">Conversiones</div>
                      <div className="mt-0.5 font-mono text-[13px] text-os-text">{row.converted}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-os-dim">Ingresos atrib.</div>
                      <div className="mt-0.5 font-mono text-[13px] text-os-text">{formatEUR(row.attributedRevenue)}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-os-dim">ROAS</div>
                      <div className="mt-0.5 font-mono text-[13px] text-os-text">{formatRoas(row.roas)}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-os-dim">CAC public.</div>
                      <div className="mt-0.5 font-mono text-[13px] text-os-text">{row.cac == null ? '—' : formatEUR(row.cac)}</div>
                    </div>
                  </div>
                </div>
                <Link
                  href={`/clients/${row.clientId}/results`}
                  className="mt-4 flex items-center justify-end border-t border-os-border pt-2.5 font-mono text-[9.5px] uppercase tracking-wide text-os-muted hover:text-os-accent"
                >
                  Ver dashboard →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

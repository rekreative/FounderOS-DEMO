'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useClientsRegistry } from '@/components/ClientsProvider';
import { getResults, type ResultsResponse } from '@/lib/api/results';
import {
  PERIOD_PRESET_OPTIONS,
  formatEUR,
  getStoredPeriodPreference,
  setStoredPeriodPreference,
  type PeriodPreset,
} from '@/lib/results';
import { SectionHead } from '@/components/terminal';
import { PageHeader } from '@/components/PageHeader';
import { BarListChart, FunnelBars, ResultsKpiStrip } from '@/components/ResultsCharts';

/** REKREATIVE Resultados — the executive portfolio overview. Selecting a
 * client navigates to its dedicated /clients/[clientId]/results dashboard;
 * this page never swaps into a per-client detail mode itself.
 *
 * Every number on this page is real PostgreSQL (lib/server/results-repo.ts
 * via GET /api/results) — an acquisition-cohort funnel + "Valor generado"
 * (SUM Lead.conversionValue over converted leads), scoped by the selected
 * period and, per client, by clientId. Ad spend/ROAS/CAC (Meta Ads Real V1)
 * come from the same response's `meta` field — real once a client has an
 * active client_meta_accounts mapping with synced data for the period,
 * honestly null (rendered as the KPI strip's "Sin datos de Meta" tiles)
 * otherwise. RevenueRecord (the manual revenue log) isn't shown on this page
 * at all in V1 — it stays fully visible/editable on each client's own
 * /clients/[clientId]/results dashboard. */
export function ResultsBoard() {
  // Canonical PostgreSQL registry — same source /clients and /leads read.
  const { clients, error: clientsError } = useClientsRegistry();
  const [resultsData, setResultsData] = useState<ResultsResponse | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });

  useEffect(() => {
    const preference = getStoredPeriodPreference();
    setPeriodPreset(preference.preset);
    if (preference.preset === 'custom') {
      setCustomRange({ start: preference.start ?? '', end: preference.end ?? '' });
    }
  }, []);

  useEffect(() => {
    setStoredPeriodPreference({
      preset: periodPreset,
      start: periodPreset === 'custom' ? customRange.start || null : null,
      end: periodPreset === 'custom' ? customRange.end || null : null,
    });
  }, [periodPreset, customRange]);

  // Real cohort/funnel/value fetch — server-resolved period (Europe/Madrid),
  // clientId-scoped per row via the byClient breakdown, no client-side N+1.
  useEffect(() => {
    if (periodPreset === 'custom' && (!customRange.start || !customRange.end)) return;
    let cancelled = false;
    getResults({
      preset: periodPreset,
      start: periodPreset === 'custom' ? customRange.start : undefined,
      end: periodPreset === 'custom' ? customRange.end : undefined,
    })
      .then((result) => {
        if (!cancelled) setResultsData(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setResultsError(error instanceof Error ? error.message : 'No se pudieron cargar los resultados.');
      });
    return () => {
      cancelled = true;
    };
  }, [periodPreset, customRange]);

  const byClientMap = useMemo(() => {
    const map = new Map<string, ResultsResponse['byClient'][number]>();
    for (const row of resultsData?.byClient ?? []) {
      if (row.clientId) map.set(row.clientId, row);
    }
    return map;
  }, [resultsData]);

  const comparison = useMemo(
    () =>
      clients
        .map((client) => {
          const row = byClientMap.get(client.id);
          return {
            clientId: client.id,
            clientName: client.name,
            crmLeads: row?.funnel.leads ?? 0,
            converted: row?.funnel.converted ?? 0,
            valueGenerated: row?.value.total ?? null,
          };
        })
        .sort((a, b) => (b.valueGenerated ?? 0) - (a.valueGenerated ?? 0)),
    [clients, byClientMap],
  );

  const valueByClient = useMemo(
    () => comparison.filter((row) => (row.valueGenerated ?? 0) > 0).map((row) => ({ key: row.clientId, label: row.clientName, value: row.valueGenerated ?? 0 })),
    [comparison],
  );
  const leadsByClient = useMemo(
    () =>
      comparison
        .filter((row) => row.crmLeads > 0)
        .map((row) => ({ key: row.clientId, label: row.clientName, value: row.crmLeads }))
        .sort((a, b) => b.value - a.value),
    [comparison],
  );

  const overall = resultsData?.overall;

  return (
    <div className="p-4">
      <PageHeader eyebrow="REKREATIVE OPERACIONES" title="Resultados" />
      <div className="-mt-4 mb-5 flex flex-wrap items-center gap-2.5">
        <p className="max-w-2xl text-[12px] text-os-muted">
          Visión global del rendimiento comercial generado para los clientes de REKREATIVE, a partir de los leads y eventos reales del CRM.
        </p>
      </div>

      {(clientsError || resultsError) && (
        <div className="mb-5 border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">
          {clientsError ?? resultsError}
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

      {/* Global KPI strip */}
      <div className="mb-6">
        <ResultsKpiStrip
          values={{
            adSpend: overall?.meta.spend ?? null,
            crmLeads: overall?.funnel.leads ?? 0,
            converted: overall?.funnel.converted ?? 0,
            valueGenerated: overall?.value.total ?? null,
            roas: overall?.meta.roas ?? null,
            cac: overall?.meta.cac ?? null,
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
              e.g. "Asistidas" and "Conversiones" are independent axes that
              can make a later milestone exceed an earlier one — an
              adjacent-stage percentage here could render an impossible rate
              like "200%". Counts stay fully visible; only the misleading
              rate labels are omitted (showRates={false}). Per-client
              dashboards keep their existing funnel + rates unchanged (a
              single client's own cohort makes that framing legitimate
              there). */}
          <SectionHead label="Hitos comerciales · clientes" />
          <FunnelBars stages={overall?.stages ?? []} showRates={false} />
        </div>
        <div className="flex flex-col gap-4">
          <div className="border border-os-border bg-os-surface p-4">
            <SectionHead label="Valor generado por cliente" />
            <BarListChart rows={valueByClient} formatValue={formatEUR} emptyLabel="Sin conversiones con valor todavía." />
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
                      <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-os-dim">Leads CRM</div>
                      <div className="mt-0.5 font-mono text-[13px] text-os-text">{row.crmLeads}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-os-dim">Conversiones</div>
                      <div className="mt-0.5 font-mono text-[13px] text-os-text">{row.converted}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-os-dim">Valor generado</div>
                      <div className="mt-0.5 font-mono text-[13px] text-os-text">
                        {row.valueGenerated == null ? '—' : formatEUR(row.valueGenerated)}
                      </div>
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

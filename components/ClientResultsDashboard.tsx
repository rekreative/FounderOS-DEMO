'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getClientById, initializeStoreIfNeeded, type Client } from '@/lib/clients';
import { getLeadEvents, getLeads, initializeLeadsStoreIfNeeded, type Lead, type LeadEvent } from '@/lib/leads';
import { getCampaigns, initializeMetaCampaignsStoreIfNeeded, type MetaCampaign } from '@/lib/meta-ads';
import {
  PERIOD_PRESET_OPTIONS,
  attendanceRate,
  bookingRate,
  closeRate,
  computeClientResults,
  createRevenueRecord,
  formatEUR,
  formatRate,
  getAdSpendUnavailableNote,
  getRevenueRecords,
  getRevenueSourceLabel,
  getStoredPeriodPreference,
  groupLeadsByPeriod,
  groupRevenueByPeriod,
  includesDemoData,
  initializeResultsStoreIfNeeded,
  qualificationRate,
  resolvePeriod,
  resolveTrendGranularity,
  setStoredPeriodPreference,
  updateRevenueRecord,
  type PeriodPreset,
  type RevenueRecord,
} from '@/lib/results';
import { SectionHead } from '@/components/terminal';
import {
  BarSeriesChart,
  DemoDataBadge,
  FunnelBars,
  ResultsKpiStrip,
  RevenueDataSourceTag,
  SparseTrendState,
} from '@/components/ResultsCharts';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
}

function EfficiencyTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-os-border bg-os-surface2 px-3 py-3">
      <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-os-dim">{label}</div>
      <div className="mt-1.5 font-mono text-[15px] font-semibold text-os-text">{value}</div>
    </div>
  );
}

type RevenueDraft = { amount: string; occurredAt: string; notes: string };

const emptyRevenueDraft = (): RevenueDraft => ({ amount: '', occurredAt: new Date().toISOString().slice(0, 10), notes: '' });

export function ClientResultsDashboard({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<Client | null>(null);
  const [notFoundChecked, setNotFoundChecked] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [revenueRecords, setRevenueRecords] = useState<RevenueRecord[]>([]);

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });

  const [showRevenueForm, setShowRevenueForm] = useState(false);
  const [editingRevenueId, setEditingRevenueId] = useState<string | null>(null);
  const [revenueDraft, setRevenueDraft] = useState<RevenueDraft>(emptyRevenueDraft());

  const refresh = () => {
    setCampaigns(getCampaigns());
    setRevenueRecords(getRevenueRecords());
    const loadedLeads = getLeads();
    setLeads(loadedLeads);
    setEvents(loadedLeads.flatMap((lead) => getLeadEvents(lead.id)));
  };

  useEffect(() => {
    initializeStoreIfNeeded();
    initializeLeadsStoreIfNeeded();
    initializeMetaCampaignsStoreIfNeeded();
    initializeResultsStoreIfNeeded();

    setClient(getClientById(clientId));
    setNotFoundChecked(true);
    refresh();

    const preference = getStoredPeriodPreference();
    setPeriodPreset(preference.preset);
    if (preference.preset === 'custom') {
      setCustomRange({ start: preference.start ?? '', end: preference.end ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

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

  const results = useMemo(
    () => computeClientResults(clientId, leads, events, campaigns, revenueRecords, period, periodPreset),
    [clientId, leads, events, campaigns, revenueRecords, period, periodPreset],
  );

  const granularity = useMemo(() => resolveTrendGranularity(periodPreset, period), [periodPreset, period]);
  const leadTrend = useMemo(() => groupLeadsByPeriod(results.cohortLeads, granularity), [results.cohortLeads, granularity]);
  const revenueTrend = useMemo(
    () => groupRevenueByPeriod(results.revenueRecordsInPeriod, granularity),
    [results.revenueRecordsInPeriod, granularity],
  );

  // Presentation-only sparseness reads — never fabricate/interpolate a
  // bucket, only decide how much chart real estate the real ones deserve.
  const leadNonZeroBuckets = useMemo(() => leadTrend.filter((point) => point.value > 0).length, [leadTrend]);
  const revenueNonZeroBuckets = useMemo(() => revenueTrend.filter((point) => point.value > 0).length, [revenueTrend]);
  const revenueChartHeight = revenueNonZeroBuckets <= 1 ? 'h-20' : revenueNonZeroBuckets <= 3 ? 'h-28' : 'h-36';

  const clientCampaigns = useMemo(() => campaigns.filter((c) => c.clientId === clientId), [campaigns, clientId]);
  const clientRevenueAll = useMemo(() => revenueRecords.filter((r) => r.clientId === clientId), [revenueRecords, clientId]);
  const showDemoBadge = includesDemoData({ revenueRecords: clientRevenueAll, campaigns: clientCampaigns });

  const spendUnavailable = periodPreset !== 'all';
  const metaCrmDifference = results.metaLeads == null ? null : results.metaLeads - results.counts.leads;

  const openCreateRevenueForm = () => {
    setEditingRevenueId(null);
    setRevenueDraft(emptyRevenueDraft());
    setShowRevenueForm(true);
  };

  const openEditRevenueForm = (record: RevenueRecord) => {
    setEditingRevenueId(record.id);
    setRevenueDraft({ amount: String(record.amount), occurredAt: record.occurredAt.slice(0, 10), notes: record.notes ?? '' });
    setShowRevenueForm(true);
  };

  const closeRevenueForm = () => {
    setShowRevenueForm(false);
    setEditingRevenueId(null);
  };

  const submitRevenue = () => {
    const amount = Number(revenueDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !revenueDraft.occurredAt) return;

    const payload = {
      clientId,
      amount,
      occurredAt: new Date(`${revenueDraft.occurredAt}T00:00:00.000Z`).toISOString(),
      notes: revenueDraft.notes.trim() || null,
    };

    if (editingRevenueId) {
      updateRevenueRecord(editingRevenueId, payload);
    } else {
      createRevenueRecord(payload);
    }

    refresh();
    closeRevenueForm();
  };

  if (notFoundChecked && !client) {
    return (
      <div className="p-4">
        <div className="mb-4">
          <Link href="/results" className="font-mono text-[10.5px] uppercase tracking-wide text-os-dim hover:text-os-accent">
            ← Volver a resultados
          </Link>
        </div>
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          Cliente no encontrado.
        </div>
      </div>
    );
  }

  if (!client) return null;

  return (
    <div className="p-4">
      {/* Breadcrumb */}
      <div className="mb-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
        <Link href="/clients" className="hover:text-os-accent">Clientes</Link>
        <span className="opacity-50">/</span>
        <Link href={`/clients/${client.id}`} className="hover:text-os-accent">{client.name}</Link>
        <span className="opacity-50">/</span>
        <span className="text-os-muted">Resultados</span>
      </div>

      {/* Header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="page-eyebrow mb-2 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.32em] text-os-dim">
            {client.sector} · {client.service}
          </div>
          <h1 className="text-[28px] font-bold uppercase leading-[1.1] tracking-[0.06em]">{client.name}</h1>
          <p className="mt-1.5 max-w-xl text-[12px] text-os-muted">
            Qué resultado comercial y financiero está generando REKREATIVE para {client.name}.
          </p>
        </div>
        {showDemoBadge && <DemoDataBadge />}
      </div>

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

      {/* Primary KPIs */}
      <div className="mb-6">
        <ResultsKpiStrip
          values={{
            adSpend: results.adSpend,
            crmLeads: results.counts.leads,
            converted: results.counts.converted,
            attributedRevenue: results.attributedRevenue,
            roas: results.roas,
            cac: results.cac,
          }}
        />
      </div>

      {/* Commercial funnel */}
      <div className="mb-6 border border-os-border bg-os-surface p-5">
        <SectionHead label="Funnel comercial" />
        <FunnelBars stages={results.stages} />
      </div>

      {/* Efficiency + acquisition — side by side, secondary to the funnel/KPIs above */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="border border-os-border bg-os-surface p-5">
          <SectionHead label="Eficiencia comercial" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <EfficiencyTile label="Tasa de cualificación" value={formatRate(qualificationRate(results.counts))} />
            <EfficiencyTile label="Lead → Cita" value={formatRate(bookingRate(results.counts))} />
            <EfficiencyTile label="Tasa de asistencia" value={formatRate(attendanceRate(results.counts))} />
            <EfficiencyTile label="Tasa de cierre" value={formatRate(closeRate(results.counts))} />
            <EfficiencyTile label="CPL CRM" value={results.cplCrm == null ? '—' : formatEUR(results.cplCrm)} />
          </div>
        </div>

        <div className="border border-os-border bg-os-surface p-5">
          <SectionHead label="Adquisición" />
          {results.metaLeads == null ? (
            <p className="font-mono text-[10.5px] text-os-dim">
              Leads Meta no disponible fuera de &quot;Todo&quot; — mismo motivo que el gasto publicitario (sin datos históricos sincronizados).
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              <EfficiencyTile label="Leads Meta" value={String(results.metaLeads)} />
              <EfficiencyTile label="Leads CRM" value={String(results.counts.leads)} />
              <EfficiencyTile label="Diferencia de registro" value={metaCrmDifference == null ? '—' : (metaCrmDifference >= 0 ? '+' : '') + metaCrmDifference} />
            </div>
          )}
        </div>
      </div>

      {/* Lead trend — a compact honest state replaces the chart when there
          are fewer than 2 non-zero buckets to actually read as a trend. */}
      <div className="mb-6 border border-os-border bg-os-surface p-5">
        <SectionHead label="Evolución de leads" />
        {leadNonZeroBuckets < 2 ? (
          <SparseTrendState points={leadTrend} granularity={granularity} formatValue={(value) => String(value)} />
        ) : (
          <BarSeriesChart points={leadTrend} granularity={granularity} formatValue={(value) => String(value)} emptyLabel="Sin leads en este periodo." />
        )}
      </div>

      {/* Attributed revenue: chart + total + records */}
      <div className="mb-6 border border-os-border bg-os-surface p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SectionHead label="Ingresos atribuidos" />
          <button
            type="button"
            onClick={openCreateRevenueForm}
            className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
          >
            + Registrar ingreso
          </button>
        </div>

        <div className="mb-4 flex items-baseline gap-2">
          <span className="font-mono text-[22px] font-semibold text-os-text">{formatEUR(results.attributedRevenue)}</span>
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">total del periodo</span>
        </div>

        {/* Chart stays (never swapped for text) — only its height adapts to
            how sparse the bucketed series actually is. */}
        <BarSeriesChart
          points={revenueTrend}
          granularity={granularity}
          formatValue={formatEUR}
          emptyLabel="Sin ingresos atribuidos en este periodo."
          heightClassName={revenueChartHeight}
        />

        <div className="mt-5 border-t border-os-border pt-4">
          {results.revenueRecordsInPeriod.length === 0 ? (
            <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
              Sin ingresos atribuidos registrados en este periodo.
            </div>
          ) : (
            <div className="overflow-x-auto border border-os-border">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-os-border bg-os-surface2">
                    {['Fecha', 'Importe', 'Fuente', 'Notas', 'Origen', ''].map((h) => (
                      <th key={h} className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-os-dim">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.revenueRecordsInPeriod.map((record) => (
                    <tr key={record.id} className="border-t border-os-border">
                      <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">{formatDate(record.occurredAt)}</td>
                      <td className="px-3 py-2.5 font-mono text-[11px] font-semibold text-os-text">{formatEUR(record.amount)}</td>
                      <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">{getRevenueSourceLabel(record.source)}</td>
                      <td className="max-w-xs truncate px-3 py-2.5 text-[11px] text-os-muted">{record.notes ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <RevenueDataSourceTag dataSource={record.dataSource} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => openEditRevenueForm(record)}
                          className="font-mono text-[9px] uppercase tracking-wide text-os-muted hover:text-os-accent"
                        >
                          editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showRevenueForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-sm-t border border-os-border bg-os-surface p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide">
                {editingRevenueId ? 'Editar ingreso' : 'Registrar ingreso'} — {client.name}
              </h2>
              <button type="button" onClick={closeRevenueForm} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                cerrar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Importe (€)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={revenueDraft.amount}
                  onChange={(event) => setRevenueDraft((prev) => ({ ...prev, amount: event.target.value }))}
                  placeholder="0"
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Fecha</span>
                <input
                  type="date"
                  value={revenueDraft.occurredAt}
                  onChange={(event) => setRevenueDraft((prev) => ({ ...prev, occurredAt: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Fuente</span>
                <input
                  disabled
                  value="Manual"
                  className="w-full cursor-not-allowed border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-dim"
                />
              </label>

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Notas</span>
                <textarea
                  value={revenueDraft.notes}
                  onChange={(event) => setRevenueDraft((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Contexto adicional (opcional)"
                  className="h-16 w-full resize-none border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>
            </div>

            <p className="mt-3 font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
              Este importe representa ingresos atribuidos a la actividad de adquisición de REKREATIVE, no la facturación total del negocio del cliente.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeRevenueForm} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Cancelar
              </button>
              <button type="button" onClick={submitRevenue} className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface">
                {editingRevenueId ? 'Guardar ingreso' : 'Registrar ingreso'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

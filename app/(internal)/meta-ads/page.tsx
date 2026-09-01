'use client';

import { useEffect, useMemo, useState } from 'react';
import { useClientsRegistry } from '@/components/ClientsProvider';
import { getMetaAdsCampaigns, type MetaAdsCampaignsResponse } from '@/lib/api/meta-ads';
import { PERIOD_PRESET_OPTIONS, type PeriodPreset } from '@/lib/results';
import { Badge, type BadgeTone } from '@/components/terminal';

// REKREATIVE Meta Ads — global board (Meta Ads Real V1). Real PostgreSQL
// only (client_meta_accounts + meta_campaign_daily_metrics via GET
// /api/meta-ads/campaigns), never the legacy demo/localStorage MetaCampaign
// store (lib/meta-ads.ts) that used to back this page. No campaign
// creation/editing here — Meta owns campaign truth; this page reports it.
// "Todos los clientes" aggregates the client portfolio. "REKREATIVE"
// explicitly selects internal agency accounts, while selecting a client
// narrows to that client's campaigns.

function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString('es-ES', { useGrouping: true })} €`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('es-ES');
}

function formatMoneyRate(value: number | null): string {
  if (value == null) return '—';
  return `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })} €`;
}

function formatPercent(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(2).replace('.', ',')}%`;
}

function formatRelativeSync(value: string | null): string {
  if (!value) return 'Sin sincronización todavía';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffHours = Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours < 1) return 'hace menos de 1h';
  if (diffHours < 24) return `hace ${Math.round(diffHours)}h`;
  return `hace ${Math.round(diffHours / 24)}d`;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'ok',
  paused: 'default',
  ended: 'default',
  archived: 'default',
};

export default function MetaAdsPage() {
  const { clients } = useClientsRegistry();
  const [clientFilter, setClientFilter] = useState<'all' | 'internal' | string>('all');
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const [data, setData] = useState<MetaAdsCampaignsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getMetaAdsCampaigns({
      clientId: clientFilter !== 'all' && clientFilter !== 'internal' ? clientFilter : undefined,
      ownerScope: clientFilter === 'internal' ? 'internal' : undefined,
      preset: periodPreset,
    })
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo cargar Meta Ads.');
      });
    return () => {
      cancelled = true;
    };
  }, [clientFilter, periodPreset]);

  const clientNameById = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-os-dim">REKREATIVE PUBLICIDAD</div>
          <h1 className="mt-1 text-[25px] font-bold uppercase tracking-[0.06em] text-os-text">Meta Ads</h1>
        </div>
        <div className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
          Última sincronización: {formatRelativeSync(data?.lastSync?.finishedAt ?? data?.lastSync?.startedAt ?? null)}
          {data?.lastSync?.status === 'error' && <span className="ml-2 text-os-err">— falló</span>}
        </div>
      </div>

      {/* Owner + period filters. Internal agency metrics are kept separate
          from the client portfolio and are selected explicitly. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Cliente</label>
          <select
            value={clientFilter}
            onChange={(event) => setClientFilter(event.target.value)}
            className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
          >
            <option value="all">Todos los clientes</option>
            <option value="internal">REKREATIVE (interno)</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          {/* No custom-range picker on this page (Results owns that) — only
              the fixed presets are offered. */}
          {PERIOD_PRESET_OPTIONS.filter((option) => option.id !== 'custom').map((option) => {
            const active = periodPreset === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setPeriodPreset(option.id)}
                className={`border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide ${
                  active ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-muted'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mb-4 border border-os-err/40 bg-os-err/10 px-3 py-2.5 font-mono text-[10.5px] text-os-err">{error}</div>
      )}

      {/* KPI summary — real spend/leads/CPL/impressions/CTR for the current
          client + period selection. Null fields render "—", never a
          fabricated number (see formatMoneyRate/formatPercent above). */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: 'Gasto', value: data ? formatCurrency(data.summary?.spend ?? 0) : '—' },
          { label: 'Leads Meta', value: data ? formatNumber(data.summary?.leads ?? 0) : '—', unit: 'atribuidos por Meta' },
          { label: 'CPL', value: formatMoneyRate(data?.summary?.cpl ?? null) },
          { label: 'Impresiones', value: data ? formatNumber(data.summary?.impressions ?? 0) : '—' },
          { label: 'CTR', value: formatPercent(data?.summary?.ctr ?? null) },
        ].map((tile) => (
          <div key={tile.label} className="border border-os-border bg-os-surface px-3 py-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">{tile.label}</div>
            <div className="mt-1.5 font-mono text-[18px] font-semibold text-os-text">{tile.value}</div>
            {tile.unit && <div className="mt-0.5 font-mono text-[9px] text-os-dim">{tile.unit}</div>}
          </div>
        ))}
      </div>

      {data && !data.hasAccountMapping && clientFilter !== 'all' && (
        <div className="mb-4 border border-dashed border-os-border px-3 py-6 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          {clientFilter === 'internal' ? 'Meta Ads interno no configurado.' : 'Meta Ads no configurado para este cliente.'}
        </div>
      )}

      {/* Per-client performance — only meaningful across the whole
          portfolio, so it's hidden once a single client is selected. */}
      {clientFilter === 'all' && data && data.byClient.length > 0 && (
        <div className="mb-4 overflow-x-auto border border-os-border bg-os-surface">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-os-surface2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
                <th className="px-3 py-2 font-normal">Cliente</th>
                <th className="px-3 py-2 font-normal">Gasto</th>
                <th className="px-3 py-2 font-normal">Leads Meta</th>
                <th className="px-3 py-2 font-normal">CPL</th>
                <th className="px-3 py-2 font-normal">CTR</th>
              </tr>
            </thead>
            <tbody>
              {data.byClient
                .slice()
                .sort((a, b) => b.summary.spend - a.summary.spend)
                .map((row) => (
                  <tr key={row.clientId} className="border-t border-os-border">
                    <td className="px-3 py-2.5 text-[13px] font-semibold text-os-text">{clientNameById.get(row.clientId) ?? row.clientId}</td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">{formatCurrency(row.summary.spend)}</td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">{formatNumber(row.summary.leads)}</td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">{formatMoneyRate(row.summary.cpl)}</td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">{formatPercent(row.summary.ctr)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Campaign overview */}
      <div className="overflow-x-auto border border-os-border bg-os-surface">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-os-surface2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
              <th className="px-3 py-2 font-normal">Campaña</th>
              <th className="px-3 py-2 font-normal">Estado</th>
              <th className="px-3 py-2 font-normal">Gasto</th>
              <th className="px-3 py-2 font-normal">Impresiones</th>
              <th className="px-3 py-2 font-normal">Clics</th>
              <th className="px-3 py-2 font-normal">CTR</th>
              <th className="px-3 py-2 font-normal">Leads Meta</th>
              <th className="px-3 py-2 font-normal">CPL</th>
            </tr>
          </thead>
          <tbody>
            {!data ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
                  Cargando…
                </td>
              </tr>
            ) : data.campaigns.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
                  {data.hasAccountMapping ? 'Sin campañas sincronizadas todavía.' : 'Sin campañas — configura una cuenta de Meta Ads para algún cliente.'}
                </td>
              </tr>
            ) : (
              data.campaigns.map((campaign) => (
                <tr key={`${campaign.metaAdAccountId ?? 'legacy'}:${campaign.metaCampaignId}`} className="border-t border-os-border">
                  <td className="px-3 py-3 text-[13px] font-semibold text-os-text">{campaign.campaignName}</td>
                  <td className="px-3 py-3">
                    <Badge tone={STATUS_TONE[campaign.status] ?? 'default'}>{campaign.status}</Badge>
                  </td>
                  <td className="px-3 py-3 font-mono text-[10.5px] text-os-text">{formatCurrency(campaign.spend)}</td>
                  <td className="px-3 py-3 font-mono text-[10.5px] text-os-muted">{formatNumber(campaign.impressions)}</td>
                  <td className="px-3 py-3 font-mono text-[10.5px] text-os-muted">{formatNumber(campaign.clicks)}</td>
                  <td className="px-3 py-3 font-mono text-[10.5px] text-os-muted">{formatPercent(campaign.ctr)}</td>
                  <td className="px-3 py-3 font-mono text-[10.5px] text-os-text">{formatNumber(campaign.leads)}</td>
                  <td className="px-3 py-3 font-mono text-[10.5px] text-os-text">{formatMoneyRate(campaign.cpl)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

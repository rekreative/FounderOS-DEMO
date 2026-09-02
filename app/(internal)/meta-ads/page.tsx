'use client';

import { useEffect, useMemo, useState } from 'react';
import { useClientsRegistry } from '@/components/ClientsProvider';
import { getMetaAdsCampaigns, type MetaAdsCampaignsResponse, type MetaSyncRunStatus } from '@/lib/api/meta-ads';
import { PERIOD_PRESET_OPTIONS, type PeriodPreset } from '@/lib/results';
import { Badge, type BadgeTone } from '@/components/terminal';

function formatCurrency(value: number): string {
  return `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })} €`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('es-ES');
}

function formatMoneyRate(value: number | null): string {
  return value == null ? '—' : formatCurrency(value);
}

function formatPercent(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(2).replace('.', ',')}%`;
}

function formatRelativeSync(value: string | null): string {
  if (!value) return 'Sin sincronización todavía';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffHours = Math.max(0, (Date.now() - date.getTime()) / 3_600_000);
  if (diffHours < 1) return 'hace menos de 1h';
  if (diffHours < 24) return `hace ${Math.round(diffHours)}h`;
  return `hace ${Math.round(diffHours / 24)}d`;
}

function inputDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function initialCustomRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { start: inputDate(start), end: inputDate(end) };
}

const STATUS_TONE: Record<string, BadgeTone> = { active: 'ok', paused: 'default', ended: 'default', archived: 'default' };
const SYNC_TONE: Record<MetaSyncRunStatus, BadgeTone> = { running: 'warn', success: 'ok', partial: 'warn', error: 'err' };
const SYNC_LABEL: Record<MetaSyncRunStatus, string> = { running: 'En curso', success: 'Correcta', partial: 'Parcial', error: 'Error' };

export default function MetaAdsPage() {
  const { clients } = useClientsRegistry();
  const [clientFilter, setClientFilter] = useState<'all' | 'internal' | string>('all');
  const [accountFilter, setAccountFilter] = useState<'all' | string>('all');
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('all');
  const initialRange = useMemo(initialCustomRange, []);
  const [customStart, setCustomStart] = useState(initialRange.start);
  const [customEnd, setCustomEnd] = useState(initialRange.end);
  const [data, setData] = useState<MetaAdsCampaignsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (periodPreset === 'custom' && (!customStart || !customEnd || customEnd < customStart)) {
      setLoading(false);
      setError(customEnd < customStart ? 'La fecha final no puede ser anterior a la inicial.' : 'Selecciona las dos fechas del periodo.');
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError(null);
    getMetaAdsCampaigns({
      clientId: clientFilter !== 'all' && clientFilter !== 'internal' ? clientFilter : undefined,
      ownerScope: clientFilter === 'internal' ? 'internal' : undefined,
      metaAdAccountId: accountFilter === 'all' ? undefined : accountFilter,
      preset: periodPreset,
      start: periodPreset === 'custom' ? customStart : undefined,
      end: periodPreset === 'custom' ? customEnd : undefined,
    })
      .then((response) => { if (!cancelled) setData(response); })
      .catch(() => {
        if (!cancelled) {
          setData(null);
          setError('No se pudo cargar el informe de Meta Ads.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accountFilter, clientFilter, customEnd, customStart, periodPreset, reloadKey]);

  const clientNameById = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const activeAccounts = useMemo(() => data?.accounts.filter((account) => account.active) ?? [], [data]);
  const visibleSyncs = useMemo(
    () => data?.accountSyncs.filter((item) => accountFilter === 'all' || item.metaAdAccountId === accountFilter) ?? [],
    [accountFilter, data],
  );

  const emptyCampaignMessage = !data?.hasAccountMapping
    ? clientFilter === 'internal'
      ? 'No hay ninguna cuenta Meta interna activa.'
      : clientFilter === 'all'
        ? 'No hay cuentas Meta activas en la cartera de clientes.'
        : 'Este cliente no tiene una cuenta Meta activa.'
    : !data.hasAnyMetrics
      ? accountFilter === 'all' ? 'Las cuentas todavía no tienen métricas sincronizadas.' : 'Esta cuenta todavía no tiene métricas sincronizadas.'
      : 'No hay datos en el periodo seleccionado.';

  const summary = data?.summary ?? null;
  const kpis = [
    { label: 'Gasto', value: summary ? formatCurrency(summary.spend) : '—' },
    { label: 'Impresiones', value: summary ? formatNumber(summary.impressions) : '—' },
    { label: 'Alcance diario*', value: summary?.reach == null ? '—' : formatNumber(summary.reach) },
    { label: 'Clics', value: summary ? formatNumber(summary.clicks) : '—' },
    { label: 'Leads Meta', value: summary ? formatNumber(summary.leads) : '—' },
    { label: 'CTR', value: formatPercent(summary?.ctr ?? null) },
    { label: 'CPC', value: formatMoneyRate(summary?.cpc ?? null) },
    { label: 'CPL', value: formatMoneyRate(summary?.cpl ?? null) },
  ];

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-os-dim">REKREATIVE PUBLICIDAD</div>
          <h1 className="mt-1 text-[25px] font-bold uppercase tracking-[0.06em] text-os-text">Meta Ads</h1>
        </div>
        <div className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
          Última sincronización: {formatRelativeSync(data?.lastSync?.finishedAt ?? data?.lastSync?.startedAt ?? null)}
          {data?.lastSync && <span className="ml-2"><Badge tone={SYNC_TONE[data.lastSync.status]}>{SYNC_LABEL[data.lastSync.status]}</Badge></span>}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 border border-os-border bg-os-surface p-3">
        <label className="flex min-w-[190px] flex-col gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Propietario</span>
          <select value={clientFilter} onChange={(event) => { setClientFilter(event.target.value); setAccountFilter('all'); }} className="border border-os-border bg-os-bg px-2.5 py-2 text-[12px] text-os-text">
            <option value="all">Todos los clientes</option>
            <option value="internal">REKREATIVE (interno)</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>

        <label className="flex min-w-[210px] flex-col gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Cuenta Meta</span>
          <select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)} disabled={activeAccounts.length === 0} className="border border-os-border bg-os-bg px-2.5 py-2 text-[12px] text-os-text disabled:opacity-50">
            <option value="all">Todas las cuentas</option>
            {activeAccounts.map((account) => <option key={account.id} value={account.metaAdAccountId}>{account.label || account.metaAdAccountId}</option>)}
          </select>
        </label>

        <div className="flex flex-1 flex-col gap-1.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Periodo</span>
          <div className="flex flex-wrap gap-1.5">
            {PERIOD_PRESET_OPTIONS.map((option) => (
              <button key={option.id} type="button" onClick={() => setPeriodPreset(option.id)} className={`border px-2.5 py-2 font-mono text-[9.5px] uppercase tracking-wide ${periodPreset === option.id ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-muted'}`}>{option.label}</button>
            ))}
          </div>
        </div>

        {periodPreset === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1.5"><span className="font-mono text-[9px] uppercase text-os-dim">Desde</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="border border-os-border bg-os-bg px-2 py-1.5 text-[11px] text-os-text" /></label>
            <label className="flex flex-col gap-1.5"><span className="font-mono text-[9px] uppercase text-os-dim">Hasta</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="border border-os-border bg-os-bg px-2 py-1.5 text-[11px] text-os-text" /></label>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border border-os-err/40 bg-os-err/10 px-3 py-2.5 text-[11px] text-os-err">
          <span>{error}</span><button type="button" onClick={() => setReloadKey((value) => value + 1)} className="border border-os-err/50 px-2.5 py-1 font-mono text-[9px] uppercase">Reintentar</button>
        </div>
      )}

      <div className="mb-2 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {kpis.map((tile) => <div key={tile.label} className="min-w-0 border border-os-border bg-os-surface px-3 py-3"><div className="break-words font-mono text-[8.5px] uppercase tracking-[0.14em] text-os-dim">{tile.label}</div><div className="mt-1.5 break-words font-mono text-[17px] font-semibold text-os-text">{loading ? '—' : tile.value}</div></div>)}
      </div>
      <div className="mb-4 text-[9px] text-os-dim">* Suma del alcance diario; puede repetir personas entre días.</div>

      {visibleSyncs.length > 0 && (
        <section className="mb-4 border border-os-border bg-os-surface">
          <div className="border-b border-os-border px-3 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">Sincronización por cuenta</div>
          <div className="grid gap-px bg-os-border sm:grid-cols-2 xl:grid-cols-3">
            {visibleSyncs.map((item) => (
              <div key={item.metaAccountId} className="min-w-0 bg-os-surface px-3 py-3">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-[12px] font-semibold text-os-text">{item.label || item.metaAdAccountId}</div><div className="mt-1 font-mono text-[9px] text-os-dim">{formatRelativeSync(item.lastSync?.finishedAt ?? item.lastSync?.startedAt ?? null)}</div></div>{item.lastSync ? <Badge tone={SYNC_TONE[item.lastSync.status]}>{SYNC_LABEL[item.lastSync.status]}</Badge> : <Badge tone="default">Sin datos</Badge>}</div>
                <div className="mt-2 font-mono text-[9px] text-os-muted">Filas procesadas: {item.lastSync?.rowsUpserted ?? 0}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {clientFilter === 'all' && accountFilter === 'all' && data && data.byClient.length > 0 && (
        <div className="mb-4 overflow-x-auto border border-os-border bg-os-surface"><table className="w-full min-w-[640px] border-collapse text-left text-sm"><thead><tr className="bg-os-surface2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim"><th className="px-3 py-2 font-normal">Cliente</th><th className="px-3 py-2 font-normal">Gasto</th><th className="px-3 py-2 font-normal">Leads Meta</th><th className="px-3 py-2 font-normal">CPL</th><th className="px-3 py-2 font-normal">CTR</th></tr></thead><tbody>{data.byClient.slice().sort((a, b) => b.summary.spend - a.summary.spend).map((row) => <tr key={row.clientId} className="border-t border-os-border"><td className="px-3 py-2.5 text-[13px] font-semibold text-os-text">{clientNameById.get(row.clientId) ?? row.clientId}</td><td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">{formatCurrency(row.summary.spend)}</td><td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">{formatNumber(row.summary.leads)}</td><td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">{formatMoneyRate(row.summary.cpl)}</td><td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">{formatPercent(row.summary.ctr)}</td></tr>)}</tbody></table></div>
      )}

      <div className="overflow-x-auto border border-os-border bg-os-surface">
        <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
          <thead><tr className="bg-os-surface2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim"><th className="px-3 py-2 font-normal">Campaña</th><th className="px-3 py-2 font-normal">Estado</th><th className="px-3 py-2 font-normal">Gasto</th><th className="px-3 py-2 font-normal">Impresiones</th><th className="px-3 py-2 font-normal">Alcance diario*</th><th className="px-3 py-2 font-normal">Clics</th><th className="px-3 py-2 font-normal">CTR</th><th className="px-3 py-2 font-normal">CPC</th><th className="px-3 py-2 font-normal">Leads Meta</th><th className="px-3 py-2 font-normal">CPL</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={10} className="px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">Cargando…</td></tr>
              : error ? <tr><td colSpan={10} className="px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">Informe no disponible.</td></tr>
                : !data || data.campaigns.length === 0 ? <tr><td colSpan={10} className="px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">{emptyCampaignMessage}</td></tr>
                  : data.campaigns.map((campaign) => <tr key={`${campaign.metaAdAccountId ?? 'legacy'}:${campaign.metaCampaignId}`} className="border-t border-os-border"><td className="max-w-[280px] break-words px-3 py-3 text-[13px] font-semibold text-os-text">{campaign.campaignName}</td><td className="px-3 py-3"><Badge tone={STATUS_TONE[campaign.status.trim().toLowerCase()] ?? 'default'}>{campaign.status}</Badge></td><td className="px-3 py-3 font-mono text-[10.5px] text-os-text">{formatCurrency(campaign.spend)}</td><td className="px-3 py-3 font-mono text-[10.5px] text-os-muted">{formatNumber(campaign.impressions)}</td><td className="px-3 py-3 font-mono text-[10.5px] text-os-muted">{campaign.reach == null ? '—' : formatNumber(campaign.reach)}</td><td className="px-3 py-3 font-mono text-[10.5px] text-os-muted">{formatNumber(campaign.clicks)}</td><td className="px-3 py-3 font-mono text-[10.5px] text-os-muted">{formatPercent(campaign.ctr)}</td><td className="px-3 py-3 font-mono text-[10.5px] text-os-muted">{formatMoneyRate(campaign.cpc)}</td><td className="px-3 py-3 font-mono text-[10.5px] text-os-text">{formatNumber(campaign.leads)}</td><td className="px-3 py-3 font-mono text-[10.5px] text-os-text">{formatMoneyRate(campaign.cpl)}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

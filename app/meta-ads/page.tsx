'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { getClients, initializeStoreIfNeeded, type Client } from '@/lib/clients';
import {
  CAMPAIGN_OBJECTIVE_OPTIONS,
  CAMPAIGN_STATUS_OPTIONS,
  META_CAMPAIGN_SCOPE_OPTIONS,
  createCampaign,
  getCampaignCPC,
  getCampaignCPL,
  getCampaignCTR,
  getCampaigns,
  getClientNameForCampaign,
  getObjectiveLabel,
  getStatusLabel,
  initializeMetaCampaignsStoreIfNeeded,
  setCampaignStatus,
  summarizeCampaigns,
  updateCampaign,
  type MetaCampaign,
  type MetaCampaignBudgetType,
  type MetaCampaignDataSource,
  type MetaCampaignObjective,
  type MetaCampaignScope,
  type MetaCampaignStatus,
} from '@/lib/meta-ads';

const STATUS_FILTERS = [{ id: 'all', label: 'Todas' }, ...CAMPAIGN_STATUS_OPTIONS];

type DraftCampaign = {
  clientId: string;
  externalCampaignId: string;
  name: string;
  status: MetaCampaignStatus;
  objective: MetaCampaignObjective;
  budgetType: MetaCampaignBudgetType;
  budgetAmount: string;
  spend: string;
  impressions: string;
  reach: string;
  clicks: string;
  leads: string;
  startDate: string;
  endDate: string;
};

const emptyDraft = (clientId = ''): DraftCampaign => ({
  clientId,
  externalCampaignId: '',
  name: '',
  status: 'draft',
  objective: 'leads',
  budgetType: 'daily',
  budgetAmount: '',
  spend: '0',
  impressions: '0',
  reach: '0',
  clicks: '0',
  leads: '0',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
});

// Explicit useGrouping avoids a runtime quirk where bare
// .toLocaleString('es-ES') silently drops the thousands separator.
function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString('es-ES', { useGrouping: true })} €`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('es-ES');
}

function formatPercent(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(2).replace('.', ',')}%`;
}

// CPC/CPL — same grouping fix as formatCurrency, decimals preserved (2dp,
// comma per es-ES) for the sub-euro/low-value rates these actually are.
function formatMoneyRate(value: number | null): string {
  if (value == null) return '—';
  return `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })} €`;
}

function formatBudget(campaign: Pick<MetaCampaign, 'budgetType' | 'dailyBudget' | 'lifetimeBudget'>): string {
  if (campaign.budgetType === 'daily') {
    return campaign.dailyBudget != null ? `${formatCurrency(campaign.dailyBudget)}/día` : '—';
  }
  return campaign.lifetimeBudget != null ? `${formatCurrency(campaign.lifetimeBudget)} total` : '—';
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
}

const DATA_SOURCE_LABEL: Record<MetaCampaignDataSource, string> = {
  demo: 'Demo',
  manual: 'Manual',
  meta_api: 'API de Meta',
};

function DataSourceTag({ dataSource }: { dataSource: MetaCampaignDataSource }) {
  const tone =
    dataSource === 'meta_api' ? 'text-os-ok' : dataSource === 'manual' ? 'text-os-muted' : 'text-os-dim';
  return (
    <span className={`inline-block border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide ${tone}`}>
      {DATA_SOURCE_LABEL[dataSource]}
    </span>
  );
}

function CampaignRow({
  campaign,
  clientName,
  showClientColumn,
  columnCount,
  expanded,
  onToggle,
  onStatusChange,
  onEdit,
}: {
  campaign: MetaCampaign;
  clientName: string;
  /** REKREATIVE scope: every row is already known to be internal, so the
   * Cliente column is redundant — hidden there, shown as-is in CLIENTES scope. */
  showClientColumn: boolean;
  /** Current visible column count (12 with Cliente shown, 11 without) — keeps
   * the expanded detail row's colSpan aligned with the header in both scopes. */
  columnCount: number;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (next: MetaCampaignStatus) => void;
  onEdit: () => void;
}) {
  const ctr = getCampaignCTR(campaign);
  const cpc = getCampaignCPC(campaign);
  const cpl = getCampaignCPL(campaign);

  return (
    <>
      <tr className="border-t border-os-border align-top">
        <td className="px-3 py-3 text-left">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={onToggle}
              className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent"
            >
              {expanded ? '−' : '+'}
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-[13px] font-semibold text-os-text">{campaign.name}</span>
                <DataSourceTag dataSource={campaign.dataSource} />
              </div>
              <div className="mt-0.5 text-[10px] text-os-dim">{getObjectiveLabel(campaign.objective)}</div>
            </div>
          </div>
        </td>
        {showClientColumn && <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{clientName}</td>}
        <td className="px-3 py-3 text-left">
          <select
            value={campaign.status}
            onChange={(event) => onStatusChange(event.target.value as MetaCampaignStatus)}
            className="w-full min-w-[110px] border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text outline-none"
          >
            {CAMPAIGN_STATUS_OPTIONS.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{getObjectiveLabel(campaign.objective)}</td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{formatBudget(campaign)}</td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-text">{formatCurrency(campaign.spend)}</td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{formatNumber(campaign.impressions)}</td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{formatNumber(campaign.clicks)}</td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{formatPercent(ctr)}</td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-text">{formatNumber(campaign.leads)}</td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-text">{formatMoneyRate(cpl)}</td>
        <td className="px-3 py-3 text-right">
          <button type="button" onClick={onEdit} className="font-mono text-[9px] uppercase tracking-wide text-os-muted hover:text-os-accent">
            editar
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columnCount} className="border-t border-os-border bg-os-surface px-3 py-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Fecha de inicio</div>
                <div className="mt-1 font-mono text-[11px] text-os-text">{formatDate(campaign.startDate)}</div>
              </div>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Fecha de fin</div>
                <div className="mt-1 font-mono text-[11px] text-os-text">{formatDate(campaign.endDate)}</div>
              </div>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Alcance</div>
                <div className="mt-1 font-mono text-[11px] text-os-text">{formatNumber(campaign.reach)}</div>
              </div>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">CPC</div>
                <div className="mt-1 font-mono text-[11px] text-os-text">{formatMoneyRate(cpc)}</div>
              </div>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Origen de datos</div>
                <div className="mt-1">
                  <DataSourceTag dataSource={campaign.dataSource} />
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function MetaAdsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  // Primary scope: REKREATIVE's own campaigns vs. client campaigns —
  // conceptually ABOVE client filtering, never a fake client. Defaults to
  // REKREATIVE. Local UI state only, same as every other filter here.
  const [moduleScope, setModuleScope] = useState<MetaCampaignScope>('internal');
  const [statusFilter, setStatusFilter] = useState<'all' | MetaCampaignStatus>('all');
  const [clientFilter, setClientFilter] = useState<'all' | string>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showForm, setShowForm] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftCampaign>(emptyDraft());

  // In REKREATIVE scope the client selector is hidden and irrelevant, so
  // always load the full set (internal campaigns have no clientId to filter
  // by); the scope filter below narrows it. In CLIENTES scope, behavior is
  // unchanged from before scope existed.
  const loadCampaigns = () => {
    if (moduleScope === 'internal') {
      setCampaigns(getCampaigns());
      return;
    }
    const activeClient = clientFilter === 'all' ? undefined : clientFilter;
    setCampaigns(getCampaigns(activeClient));
  };

  useEffect(() => {
    initializeStoreIfNeeded();
    initializeMetaCampaignsStoreIfNeeded();
    setClients(getClients());
    setCampaigns(getCampaigns());
  }, []);

  useEffect(() => {
    loadCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter, moduleScope]);

  // Scope filter — sits above search/status. "Todos los clientes" (CLIENTES
  // scope, no client picked) must never include REKREATIVE's own
  // campaigns; this guarantees it regardless of what `campaigns` holds.
  const scopedCampaigns = useMemo(() => campaigns.filter((c) => c.scope === moduleScope), [campaigns, moduleScope]);

  // Search is client-side, UI-only state — never persisted, matches
  // campaign name, client name, and objective case-insensitively. Operates
  // only within the currently selected scope.
  const searchedCampaigns = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scopedCampaigns;
    return scopedCampaigns.filter((campaign) => {
      const clientName = getClientNameForCampaign(campaign.clientId).toLowerCase();
      const objective = getObjectiveLabel(campaign.objective).toLowerCase();
      return campaign.name.toLowerCase().includes(q) || clientName.includes(q) || objective.includes(q);
    });
  }, [scopedCampaigns, query]);

  // Status filter counts — computed from the already-loaded, search-filtered
  // campaigns (never a new metric/store); reacts live as the search narrows.
  const statusCounts = useMemo(() => {
    const counts: Record<'all' | MetaCampaignStatus, number> = {
      all: searchedCampaigns.length,
    } as Record<'all' | MetaCampaignStatus, number>;
    for (const option of CAMPAIGN_STATUS_OPTIONS) {
      counts[option.id] = searchedCampaigns.filter((campaign) => campaign.status === option.id).length;
    }
    return counts;
  }, [searchedCampaigns]);

  const visibleCampaigns = useMemo(
    () =>
      searchedCampaigns.filter((campaign) => {
        if (statusFilter !== 'all' && campaign.status !== statusFilter) return false;
        return true;
      }),
    [searchedCampaigns, statusFilter],
  );

  const summary = useMemo(() => summarizeCampaigns(visibleCampaigns), [visibleCampaigns]);

  // REKREATIVE scope: every row is already known to be internal, so the
  // Cliente column is redundant there — shown as-is in CLIENTES scope.
  const showClientColumn = moduleScope === 'client';
  const columnCount = showClientColumn ? 12 : 11;

  const openCreateForm = () => {
    const firstClient = moduleScope === 'client' ? clients[0]?.id ?? '' : '';
    setDraft(emptyDraft(firstClient));
    setEditingCampaignId(null);
    setShowForm(true);
  };

  const openEditForm = (campaign: MetaCampaign) => {
    setEditingCampaignId(campaign.id);
    setDraft({
      clientId: campaign.clientId ?? '',
      externalCampaignId: campaign.externalCampaignId ?? '',
      name: campaign.name,
      status: campaign.status,
      objective: campaign.objective,
      budgetType: campaign.budgetType,
      budgetAmount: String(campaign.budgetType === 'daily' ? campaign.dailyBudget ?? '' : campaign.lifetimeBudget ?? ''),
      spend: String(campaign.spend),
      impressions: String(campaign.impressions),
      reach: String(campaign.reach),
      clicks: String(campaign.clicks),
      leads: String(campaign.leads),
      startDate: campaign.startDate,
      endDate: campaign.endDate ?? '',
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingCampaignId(null);
    setDraft(emptyDraft(clients[0]?.id ?? ''));
  };

  const submitCampaign = () => {
    const name = draft.name.trim();
    const scope: MetaCampaignScope = moduleScope;
    const clientId = scope === 'client' ? draft.clientId : null;
    if (!name || (scope === 'client' && !clientId)) return;

    const budgetAmount = draft.budgetAmount.trim() === '' ? null : Number(draft.budgetAmount);
    const normalized = {
      scope,
      clientId,
      externalCampaignId: draft.externalCampaignId.trim() || null,
      name,
      status: draft.status,
      objective: draft.objective,
      budgetType: draft.budgetType,
      dailyBudget: draft.budgetType === 'daily' ? budgetAmount : null,
      lifetimeBudget: draft.budgetType === 'lifetime' ? budgetAmount : null,
      spend: Number(draft.spend) || 0,
      impressions: Number(draft.impressions) || 0,
      reach: Number(draft.reach) || 0,
      clicks: Number(draft.clicks) || 0,
      leads: Number(draft.leads) || 0,
      startDate: draft.startDate,
      endDate: draft.endDate.trim() || null,
    };

    if (editingCampaignId) {
      updateCampaign(editingCampaignId, normalized);
    } else {
      createCampaign({ ...normalized, dataSource: 'manual' });
    }

    loadCampaigns();
    closeForm();
  };

  const handleStatusChange = (campaignId: string, next: MetaCampaignStatus) => {
    setCampaignStatus(campaignId, next);
    loadCampaigns();
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-os-dim">REKREATIVE PUBLICIDAD</div>
          <h1 className="mt-1 text-[25px] font-bold uppercase tracking-[0.06em] text-os-text">Meta Ads</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCreateForm}
            className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
          >
            Nueva campaña
          </button>
        </div>
      </div>

      {/* Primary scope — REKREATIVE's own acquisition vs. client campaigns.
          Conceptually above every filter below, including the KPI row;
          REKREATIVE is never a client, so this never touches the client
          selector's options. */}
      <div className="mb-4 flex items-center gap-1.5">
        {META_CAMPAIGN_SCOPE_OPTIONS.map((option) => {
          const active = moduleScope === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setModuleScope(option.id)}
              className={`border px-3 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide ${
                active ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-muted'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* KPI summary — recalculated from only the currently selected scope
          (see scopedCampaigns → searchedCampaigns → visibleCampaigns →
          summary below). "Leads Meta" is explicit: Meta-platform-attributed
          leads, never CRM leads (see /leads). CPL below stays this same
          Meta-attributed count / spend, unchanged. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: 'Gasto', value: formatCurrency(summary.spend), unit: null },
          { label: 'Leads Meta', value: formatNumber(summary.leads), unit: 'atribuidos por Meta' },
          { label: 'CPL', value: formatMoneyRate(summary.cpl), unit: null },
          { label: 'Impresiones', value: formatNumber(summary.impressions), unit: null },
          { label: 'CTR', value: formatPercent(summary.ctr), unit: null },
        ].map((tile) => (
          <div key={tile.label} className="border border-os-border bg-os-surface px-3 py-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">{tile.label}</div>
            <div className="mt-1.5 font-mono text-[18px] font-semibold text-os-text">{tile.value}</div>
            {tile.unit && <div className="mt-0.5 font-mono text-[9px] text-os-dim">{tile.unit}</div>}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-os-dim" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar campaña..."
            className="border border-os-border bg-os-surface py-1.5 pl-8 pr-2.5 text-[12.5px] text-os-text outline-none placeholder:text-os-dim focus:border-os-border-strong"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((option) => {
            const active = statusFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatusFilter(option.id as 'all' | MetaCampaignStatus)}
                className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${
                  active ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-muted'
                }`}
              >
                {option.label} <span className="opacity-70">{statusCounts[option.id as 'all' | MetaCampaignStatus] ?? 0}</span>
              </button>
            );
          })}
        </div>

        {moduleScope === 'client' && (
          <div className="ml-auto flex items-center gap-2">
            <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Cliente</label>
            <select
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
            >
              <option value="all">Todos los clientes</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Campaign table */}
      <div className="overflow-x-auto rounded-sm-t border border-os-border bg-os-surface">
        <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-os-surface2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
              <th className="px-3 py-2 font-normal">Campaña</th>
              {showClientColumn && <th className="px-3 py-2 font-normal">Cliente</th>}
              <th className="px-3 py-2 font-normal">Estado</th>
              <th className="px-3 py-2 font-normal">Objetivo</th>
              <th className="px-3 py-2 font-normal">Presupuesto</th>
              <th className="px-3 py-2 font-normal">Gasto</th>
              <th className="px-3 py-2 font-normal">Impresiones</th>
              <th className="px-3 py-2 font-normal">Clics</th>
              <th className="px-3 py-2 font-normal">CTR</th>
              <th className="px-3 py-2 font-normal">Leads Meta</th>
              <th className="px-3 py-2 font-normal">CPL</th>
              <th className="px-3 py-2 font-normal text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibleCampaigns.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
                  No hay campañas que coincidan con estos filtros.
                </td>
              </tr>
            ) : (
              visibleCampaigns.map((campaign) => (
                <CampaignRow
                  key={campaign.id}
                  campaign={campaign}
                  clientName={getClientNameForCampaign(campaign.clientId)}
                  showClientColumn={showClientColumn}
                  columnCount={columnCount}
                  expanded={Boolean(expanded[campaign.id])}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [campaign.id]: !prev[campaign.id] }))}
                  onStatusChange={(next) => handleStatusChange(campaign.id, next)}
                  onEdit={() => openEditForm(campaign)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-sm-t border border-os-border bg-os-surface p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide">{editingCampaignId ? 'Editar campaña' : 'Nueva campaña'}</h2>
              <button type="button" onClick={closeForm} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                cerrar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {moduleScope === 'client' ? (
                <label className="col-span-2">
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Cliente</span>
                  <select
                    value={draft.clientId}
                    onChange={(event) => setDraft((prev) => ({ ...prev, clientId: event.target.value }))}
                    className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                  >
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="col-span-2">
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Cliente</span>
                  <input
                    disabled
                    value="Interno · REKREATIVE"
                    className="w-full cursor-not-allowed border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-dim"
                  />
                </label>
              )}

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Nombre</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Estado</span>
                <select
                  value={draft.status}
                  onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value as MetaCampaignStatus }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  {CAMPAIGN_STATUS_OPTIONS.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Objetivo</span>
                <select
                  value={draft.objective}
                  onChange={(event) => setDraft((prev) => ({ ...prev, objective: event.target.value as MetaCampaignObjective }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  {CAMPAIGN_OBJECTIVE_OPTIONS.map((objective) => (
                    <option key={objective.id} value={objective.id}>
                      {objective.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Tipo de presupuesto</span>
                <select
                  value={draft.budgetType}
                  onChange={(event) => setDraft((prev) => ({ ...prev, budgetType: event.target.value as MetaCampaignBudgetType }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  <option value="daily">Diario</option>
                  <option value="lifetime">Total</option>
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
                  {draft.budgetType === 'daily' ? 'Presupuesto diario' : 'Presupuesto total'}
                </span>
                <input
                  type="number"
                  value={draft.budgetAmount}
                  onChange={(event) => setDraft((prev) => ({ ...prev, budgetAmount: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Gasto</span>
                <input
                  type="number"
                  value={draft.spend}
                  onChange={(event) => setDraft((prev) => ({ ...prev, spend: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Impresiones</span>
                <input
                  type="number"
                  value={draft.impressions}
                  onChange={(event) => setDraft((prev) => ({ ...prev, impressions: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Alcance</span>
                <input
                  type="number"
                  value={draft.reach}
                  onChange={(event) => setDraft((prev) => ({ ...prev, reach: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Clics</span>
                <input
                  type="number"
                  value={draft.clicks}
                  onChange={(event) => setDraft((prev) => ({ ...prev, clicks: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Leads (atribuidos por Meta)</span>
                <input
                  type="number"
                  value={draft.leads}
                  onChange={(event) => setDraft((prev) => ({ ...prev, leads: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Fecha de inicio</span>
                <input
                  type="date"
                  value={draft.startDate}
                  onChange={(event) => setDraft((prev) => ({ ...prev, startDate: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Fecha de fin</span>
                <input
                  type="date"
                  value={draft.endDate}
                  onChange={(event) => setDraft((prev) => ({ ...prev, endDate: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">ID de campaña externa (opcional)</span>
                <input
                  value={draft.externalCampaignId}
                  onChange={(event) => setDraft((prev) => ({ ...prev, externalCampaignId: event.target.value }))}
                  placeholder="Se completará cuando se conecte la API de Meta Marketing"
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Cancelar
              </button>
              <button type="button" onClick={submitCampaign} className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface">
                {editingCampaignId ? 'Guardar campaña' : 'Crear campaña'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

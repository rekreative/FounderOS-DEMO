'use client';

import Link from 'next/link';
import {
  getCampaignCPL,
  getObjectiveLabel,
  getStatusLabel,
  summarizeCampaigns,
  type MetaCampaign,
  type MetaCampaignDataSource,
  type MetaCampaignStatus,
} from '@/lib/meta-ads';
import { Badge, type BadgeTone } from '@/components/terminal';

// Client-scoped Meta Ads tab — reads the SAME MetaCampaign store the global
// /meta-ads page uses (getCampaigns(clientId) filters by clientId; there is
// no client-specific campaign store). Read-only here: editing a campaign
// still happens on /meta-ads. MetaCampaign.spend is lifetime-cumulative per
// campaign — this view only ever aggregates/shows that lifetime total, never
// a period-specific ("this week"/"this month") spend figure, since no such
// data exists anywhere in the repo (see lib/results.ts's resolveAdSpend for
// the same constraint).

// Explicit useGrouping avoids a runtime quirk where bare
// .toLocaleString('es-ES') silently drops the thousands separator (same fix
// already applied in components/ClientsList.tsx / the global Meta Ads and
// Results modules).
function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString('es-ES', { useGrouping: true })} €`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('es-ES');
}

// CPL — same grouping fix as formatCurrency, decimals preserved (2dp, comma
// per es-ES) for the sub-euro/low-value rates these actually are. Matches
// the already-approved global /meta-ads formatMoneyRate exactly.
function formatMoneyRate(value: number | null): string {
  if (value == null) return '—';
  return `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })} €`;
}

const STATUS_TONE: Record<MetaCampaignStatus, BadgeTone> = {
  active: 'ok',
  paused: 'default',
  ended: 'default',
  draft: 'default',
};

const DATA_SOURCE_LABEL: Record<MetaCampaignDataSource, string> = {
  demo: 'Demo',
  manual: 'Manual',
  meta_api: 'API de Meta',
};

export function ClientMetaAdsPanel({ campaigns }: { campaigns: MetaCampaign[] }) {
  const summary = summarizeCampaigns(campaigns);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Meta Ads</h3>
        <Link
          href="/meta-ads"
          className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim hover:text-os-accent"
        >
          Ver en Meta Ads →
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          Sin campañas de Meta Ads registradas para este cliente.
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Campañas', value: String(campaigns.length) },
              { label: 'Gasto acumulado', value: formatCurrency(summary.spend) },
              { label: 'Leads (Meta)', value: formatNumber(summary.leads) },
              { label: 'CPL', value: formatMoneyRate(summary.cpl) },
            ].map((tile) => (
              <div key={tile.label} className="border border-os-border bg-os-surface2 px-3 py-2.5">
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{tile.label}</div>
                <div className="mt-1.5 font-mono text-[15px] font-semibold text-os-text">{tile.value}</div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden border border-os-border bg-os-surface">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-os-surface2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
                  <th className="px-3 py-2 font-normal">Campaña</th>
                  <th className="px-3 py-2 font-normal">Estado</th>
                  <th className="px-3 py-2 font-normal">Objetivo</th>
                  <th className="px-3 py-2 font-normal">Gasto</th>
                  <th className="px-3 py-2 font-normal">Leads</th>
                  <th className="px-3 py-2 font-normal">CPL</th>
                  <th className="px-3 py-2 font-normal">Origen</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-t border-os-border">
                    <td className="px-3 py-2.5 text-[13px] font-semibold text-os-text">{campaign.name}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={STATUS_TONE[campaign.status]}>{getStatusLabel(campaign.status)}</Badge>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">
                      {getObjectiveLabel(campaign.objective)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">
                      {formatCurrency(campaign.spend)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">
                      {formatNumber(campaign.leads)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">
                      {formatMoneyRate(getCampaignCPL(campaign))}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[9px] uppercase tracking-wide text-os-dim">
                      {DATA_SOURCE_LABEL[campaign.dataSource]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

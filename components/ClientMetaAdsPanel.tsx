'use client';

import Link from 'next/link';
import type { MetaAdsCampaignsResponse } from '@/lib/api/meta-ads';
import { Badge, type BadgeTone } from '@/components/terminal';

// Client-scoped Meta Ads tab — real PostgreSQL data (Meta Ads Real V1).
// Purely presentational: `data` is the SAME GET /api/meta-ads/campaigns
// response the parent client workspace page (app/clients/[clientId]/page.tsx)
// already fetches once for the Overview summary card — never a second,
// duplicate query for the same client, and never the demo/localStorage
// MetaCampaign store lib/meta-ads.ts still owns.
//
// Four honest states, never blended:
//   A. no active client_meta_accounts mapping -> "Meta Ads no configurado"
//   B. mapped, zero synced rows yet           -> "Sin datos sincronizados todavía"
//   C. mapped, most recent sync run failed    -> shows the real sync error
//   D. mapped, real data exists               -> real campaign metrics

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

// Uppercase keys — Meta's real Marketing API returns statuses in UPPERCASE
// ('ACTIVE', 'PAUSED', 'ARCHIVED', ...) and the real ingestion contract
// stores that string verbatim. Looked up via .toUpperCase() below so a
// lowercase status (harmless, but not what Meta actually sends) still
// resolves correctly instead of silently falling through to 'default'.
const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'ok',
  PAUSED: 'default',
  ARCHIVED: 'default',
  ENDED: 'default',
};

export function ClientMetaAdsPanel({ data, error }: { data: MetaAdsCampaignsResponse | null; error: string | null }) {
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

      {error && (
        <div className="border border-os-err/40 bg-os-err/10 px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-err">
          {error}
        </div>
      )}

      {!error && !data && (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          Cargando…
        </div>
      )}

      {!error && data && !data.hasAccountMapping && (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          Meta Ads no configurado para este cliente.
        </div>
      )}

      {!error && data && data.hasAccountMapping && (
        <>
          {data.lastSync?.status === 'error' && (
            <div className="mb-4 border border-os-err/40 bg-os-err/10 px-3 py-2.5 font-mono text-[10.5px] text-os-err">
              La última sincronización falló{data.lastSync.errorMessage ? `: ${data.lastSync.errorMessage}` : '.'}
            </div>
          )}

          {data.campaigns.length === 0 ? (
            <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
              Cuenta de Meta Ads mapeada. Sin datos sincronizados todavía.
            </div>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: 'Campañas', value: String(data.campaigns.length) },
                  { label: 'Gasto', value: formatCurrency(data.summary?.spend ?? 0) },
                  { label: 'Leads (Meta)', value: formatNumber(data.summary?.leads ?? 0) },
                  { label: 'CPL', value: formatMoneyRate(data.summary?.cpl ?? null) },
                ].map((tile) => (
                  <div key={tile.label} className="min-w-0 border border-os-border bg-os-surface2 px-3 py-2.5">
                    <div className="break-words font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{tile.label}</div>
                    <div className="mt-1.5 break-words font-mono text-[15px] font-semibold text-os-text">{tile.value}</div>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto border border-os-border bg-os-surface">
                <table className="min-w-[680px] w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-os-surface2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
                      <th className="px-3 py-2 font-normal">Campaña</th>
                      <th className="px-3 py-2 font-normal">Estado</th>
                      <th className="px-3 py-2 font-normal">Gasto</th>
                      <th className="px-3 py-2 font-normal">Impresiones</th>
                      <th className="px-3 py-2 font-normal">CTR</th>
                      <th className="px-3 py-2 font-normal">Leads</th>
                      <th className="px-3 py-2 font-normal">CPL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((campaign) => (
                      <tr key={campaign.metaCampaignId} className="border-t border-os-border">
                        <td className="max-w-[240px] break-words px-3 py-2.5 text-[13px] font-semibold text-os-text">{campaign.campaignName}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={STATUS_TONE[campaign.status.toUpperCase()] ?? 'default'}>{campaign.status}</Badge>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">{formatCurrency(campaign.spend)}</td>
                        <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">{formatNumber(campaign.impressions)}</td>
                        <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">{formatPercent(campaign.ctr)}</td>
                        <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">{formatNumber(campaign.leads)}</td>
                        <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-text">{formatMoneyRate(campaign.cpl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

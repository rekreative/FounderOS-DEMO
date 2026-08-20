'use client';

import Link from 'next/link';
import { formatEUR } from '@/lib/results';

// Results tab inside the client workspace — a compact call-to-action only.
// The full dashboard (period controls, funnel, trend charts, ROAS/CAC,
// revenue-entry form) stays exclusively at /clients/[clientId]/results via
// ClientResultsDashboard; this component deliberately never recreates any of
// that. attributedRevenueAllTime is the one number shown here, computed by
// the caller via lib/results.ts's existing sumAttributedRevenue — no new
// derivation happens in this component.

export function ClientResultsPreview({
  clientId,
  clientName,
  attributedRevenueAllTime,
}: {
  clientId: string;
  clientName: string;
  attributedRevenueAllTime: number;
}) {
  return (
    <div className="flex flex-col items-start gap-3 border border-os-border bg-os-surface2 p-4">
      <div>
        <h3 className="mb-1 font-semibold text-os-text">Resultados</h3>
        <p className="text-sm text-os-dim">
          Gasto publicitario, funnel comercial, ingresos atribuidos, ROAS y CAC de {clientName} viven en su propio
          dashboard dedicado.
        </p>
        <p className="mt-2 font-mono text-[11px] text-os-muted">
          Ingresos atribuidos (histórico): <span className="font-semibold text-os-text">{formatEUR(attributedRevenueAllTime)}</span>
        </p>
      </div>
      <Link
        href={`/clients/${clientId}/results`}
        className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
      >
        Ver dashboard completo →
      </Link>
    </div>
  );
}

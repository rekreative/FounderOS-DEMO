'use client';

import {
  formatEUR,
  formatRate,
  formatRoas,
  formatTrendBucketLabel,
  type FunnelStageRow,
  type RevenueRecord,
  type TrendGranularity,
  type TrendPoint,
} from '@/lib/results';
import { Badge } from '@/components/terminal';

// Shared visual primitives for the Results executive dashboards (/results and
// /clients/[clientId]/results). Presentation only — every number rendered
// here is computed by lib/results.ts and passed in as a prop; no metric
// formula is duplicated in this file. Dependency-free: CSS bars + native
// `title` tooltips, matching the existing MiniBars/SharePie approach rather
// than adding a charting library (none is installed, and none is needed for
// the single-series magnitude/time charts Results needs).

// ===== KPI strip =====

export function ResultsKpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-os-border bg-os-surface px-4 py-4">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-os-dim">{label}</div>
      <div className="mt-2 font-mono text-[26px] font-semibold leading-none text-os-text">{value}</div>
    </div>
  );
}

export type ResultsKpiValues = {
  adSpend: number | null;
  crmLeads: number;
  converted: number;
  attributedRevenue: number;
  roas: number | null;
  cac: number | null;
};

/** The approved six-KPI hierarchy, in the approved order — the one place
 * that order and formatting live, so /results and /clients/[clientId]/results
 * can never drift apart on it. */
export function ResultsKpiStrip({ values }: { values: ResultsKpiValues }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      <ResultsKpiTile label="Gasto publicitario" value={values.adSpend == null ? '—' : formatEUR(values.adSpend)} />
      <ResultsKpiTile label="Leads CRM" value={String(values.crmLeads)} />
      <ResultsKpiTile label="Conversiones" value={String(values.converted)} />
      <ResultsKpiTile label="Ingresos atribuidos" value={formatEUR(values.attributedRevenue)} />
      <ResultsKpiTile label="ROAS" value={formatRoas(values.roas)} />
      <ResultsKpiTile label="CAC publicitario" value={values.cac == null ? '—' : formatEUR(values.cac)} />
    </div>
  );
}

// ===== Demo indicator =====

/** Subtle, non-dominant marker — shown only when the computed result set
 * actually includes demo-sourced RevenueRecord/MetaCampaign rows (see
 * lib/results.ts's includesDemoData). Never applied to manual, user-entered
 * records. */
export function DemoDataBadge() {
  return (
    <Badge tone="default" ghost>
      Incluye datos demo
    </Badge>
  );
}

// ===== Commercial funnel =====

/**
 * Horizontal sequence of stage blocks — derives entirely from real CRM
 * state/events (lib/results.ts buildLeadFunnel/buildFunnelStages); this
 * component only changes how those exact counts/rates are drawn, never what
 * they are. Each block reads label → count → the rate that got there from
 * the previous stage, so the whole commercial funnel is legible in a couple
 * of seconds (e.g. during a client call) without needing to compare bar
 * widths. `flex-wrap` (not a fixed-column grid) lets it size itself
 * correctly whether it's rendered full-width or inside a half-width panel,
 * without a container-query breakpoint this codebase doesn't have. Single
 * ink hue throughout — no categorical color, consistent with the rest of
 * REKREATIVE's monochrome terminal system. */
export function FunnelBars({ stages }: { stages: FunnelStageRow[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {stages.map((stage, index) => (
        <div
          key={stage.id}
          className="flex min-w-[104px] flex-1 flex-col items-center justify-center border border-os-border bg-os-surface2 px-3 py-4 text-center"
        >
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">{stage.label}</div>
          <div className="mt-2 font-mono text-[26px] font-bold leading-none text-os-text">{stage.count}</div>
          <div className="mt-2 h-3 font-mono text-[10px] uppercase tracking-wide text-os-dim">
            {index === 0 ? '' : `→ ${formatRate(stage.rateFromPrevious)}`}
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== Ranked bar list (client comparisons) =====

export type BarListRow = { key: string; label: string; value: number };

/** Single-hue ranked horizontal bars — identity comes from the direct label,
 * not from color, so no legend is needed for this single-series comparison
 * (see dataviz guidance: a single series carries its own identity via its
 * title, not a color key). */
export function BarListChart({
  rows,
  formatValue,
  emptyLabel = 'Sin datos todavía.',
}: {
  rows: BarListRow[];
  formatValue: (value: number) => string;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
        {emptyLabel}
      </div>
    );
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-3">
          <div className="w-28 shrink-0 truncate font-mono text-[10.5px] uppercase tracking-wide text-os-dim" title={row.label}>
            {row.label}
          </div>
          <div className="relative h-5 flex-1 border border-os-border bg-os-surface2">
            <div
              className="h-full border-r border-[var(--accent-line)] bg-[var(--accent-soft)]"
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </div>
          <div className="w-20 shrink-0 text-right font-mono text-[11px] font-semibold text-os-text">{formatValue(row.value)}</div>
        </div>
      ))}
    </div>
  );
}

// ===== Time-bucketed bar chart (lead/revenue trends) =====

/** Single-series bar chart over time buckets. A native `title` attribute per
 * bar gives a free hover tooltip (value + bucket label) without any JS
 * tooltip layer — consistent with SharePie's native SVG `<title>` approach
 * elsewhere in this codebase. X-axis labels are sparse (~8 max) so they never
 * collide regardless of how many buckets the period produces. `heightClassName`
 * lets a sparse dataset render at a shorter height instead of always
 * claiming a fixed, oversized plot area — the caller decides what "sparse"
 * means for its own data (see ClientResultsDashboard's revenue trend). */
export function BarSeriesChart({
  points,
  granularity,
  formatValue,
  emptyLabel = 'Sin datos en este periodo.',
  heightClassName = 'h-36',
}: {
  points: TrendPoint[];
  granularity: TrendGranularity;
  formatValue: (value: number) => string;
  emptyLabel?: string;
  heightClassName?: string;
}) {
  if (points.length === 0) {
    return (
      <div className="border border-dashed border-os-border px-3 py-10 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
        {emptyLabel}
      </div>
    );
  }

  const max = Math.max(...points.map((point) => point.value), 1);
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className={`flex ${heightClassName} items-end gap-1`}>
      {points.map((point, index) => {
        const label = formatTrendBucketLabel(point.bucket, granularity);
        return (
          <div key={point.bucket} className="flex h-full flex-1 flex-col items-center justify-end">
            <div
              title={`${label} · ${formatValue(point.value)}`}
              className="w-full min-w-[3px] border-t-2 border-[var(--accent-line)] bg-[var(--accent-soft)] transition-opacity hover:opacity-80"
              style={{ height: `${Math.max(2, (point.value / max) * 100)}%` }}
            />
            {index % labelEvery === 0 && (
              <div className="mt-1.5 whitespace-nowrap font-mono text-[8px] uppercase tracking-wide text-os-dim">{label}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Honest fallback for a trend chart whose bucketed series has fewer than 2
 * non-zero buckets — too sparse to read as a trend, so this shows a compact
 * statement instead of a mostly-empty full-height chart. With exactly one
 * real data point, that point is still shown (never dropped, never
 * interpolated) as a plain label: value line rather than a one-bar "chart".
 * Zero non-zero buckets renders the honest message alone.
 */
export function SparseTrendState({
  points,
  granularity,
  formatValue,
  message = 'Datos históricos insuficientes para mostrar una tendencia.',
}: {
  points: TrendPoint[];
  granularity: TrendGranularity;
  formatValue: (value: number) => string;
  message?: string;
}) {
  const nonZero = points.filter((point) => point.value > 0);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border border-dashed border-os-border px-3 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wide text-os-dim">{message}</span>
      {nonZero.map((point) => (
        <span key={point.bucket} className="font-mono text-[11px] text-os-text">
          {formatTrendBucketLabel(point.bucket, granularity)}: <strong>{formatValue(point.value)}</strong>
        </span>
      ))}
    </div>
  );
}

// ===== Revenue record data-source tag =====

export function RevenueDataSourceTag({ dataSource }: { dataSource: RevenueRecord['dataSource'] }) {
  const tone = dataSource === 'manual' ? 'text-os-muted' : 'text-os-dim';
  const label = dataSource === 'manual' ? 'Manual' : 'Demo';
  return (
    <span className={`inline-block border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}

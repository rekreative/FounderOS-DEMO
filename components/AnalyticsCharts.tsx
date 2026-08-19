'use client';

import { formatRate } from '@/lib/results';
import type { ClientBenchmarkRow, PortfolioBenchmark, PortfolioFinding, SourceAcquisitionRow } from '@/lib/analytics-portfolio';

// Presentation-only primitives specific to REKREATIVE Analytics (portfolio
// benchmarking, integration coverage, the findings feed). Reuses
// ResultsCharts/terminal primitives where a generic one already exists
// (BarListChart, DemoDataBadge, the nested SectionHead) rather than
// duplicating them — this file only adds what's genuinely new, and only at
// the tiers those shared primitives don't already cover (page-level section
// titles, mid-level group panels). No chart library; same dependency-free
// CSS/SVG approach as the rest of the app. Visual language only — no
// calculation, formula, or data source lives in this file.

// ===== Section / group headers (Analytics-scoped — never touches the
// shared terminal.tsx SectionHead used by Results/Integrations/etc.) =====

/** The five top-level Analytics sections (Cartera, Comparativa comercial, …).
 * Deliberately larger and heavier than the shared SectionHead so the page
 * reads as an executive dashboard with real hierarchy, not a flat list of
 * equal-weight labels — but scoped to this file so no other page's
 * typography shifts. */
export function AnalyticsSectionHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-os-border pb-2.5">
      <h2 className="font-mono text-[16px] font-bold uppercase tracking-[0.04em] text-os-text sm:text-[18px]">{title}</h2>
      {subtitle && <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-os-dim">{subtitle}</span>}
    </div>
  );
}

/** A mid-tier grouping panel — one notch below AnalyticsSectionHead, one
 * notch above the shared (nested) SectionHead. Used to bundle related
 * content into one visually distinct block: the three Operational
 * Infrastructure groups, the two Acquisition Quality blocks (CRM source vs
 * AI analysis), and — with `muted` — genuinely secondary/supporting context
 * like the Meta campaign counts in Cartera, which should read as quieter
 * than the primary Status/Sector/Service distributions next to it. */
export function GroupPanel({
  title,
  subtitle,
  muted = false,
  children,
}: {
  title: string;
  subtitle?: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={muted ? 'border border-dashed border-os-border p-3.5 sm:p-4' : 'border border-os-border-strong bg-os-bg2 p-4 sm:p-5'}>
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
        <span
          className={`font-mono font-bold uppercase text-os-text ${muted ? 'text-[10px] tracking-[0.14em] text-os-muted' : 'text-[12px] tracking-[0.16em]'}`}
        >
          {title}
        </span>
        {subtitle && <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-os-dim">{subtitle}</span>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

// ===== Stat tile (generic label/value block) — value dominates the label =====

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-os-border bg-os-surface px-4 py-3.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{label}</div>
      <div className="mt-1.5 font-mono text-[30px] font-bold leading-none tracking-tight text-os-text">{value}</div>
      {hint && <div className="mt-1.5 font-mono text-[9px] leading-snug text-os-dim">{hint}</div>}
    </div>
  );
}

// ===== Honest note (small-N benchmark disclaimer, sparse trend fallback, etc.) =====

export function HonestNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-os-border bg-os-surface2 px-3.5 py-2.5 font-mono text-[10.5px] leading-relaxed text-os-dim">
      {children}
    </div>
  );
}

// ===== Commercial benchmarking table =====

const BENCHMARK_METRICS: { key: keyof PortfolioBenchmark & keyof ClientBenchmarkRow; label: string }[] = [
  { key: 'qualificationRate', label: 'Cualificación' },
  { key: 'leadToAppointmentRate', label: 'Lead → Cita' },
  { key: 'attendanceRate', label: 'Asistencia' },
  { key: 'closeRate', label: 'Cierre' },
];

/** Red/green appear ONLY here, and only for a non-zero, non-null delta
 * against the portfolio benchmark — a null denominator or an exact match
 * both stay neutral grey. `—` is preserved exactly where the underlying rate
 * is unavailable. */
function DeltaTag({ clientRate, portfolioRate }: { clientRate: number | null; portfolioRate: number | null }) {
  if (clientRate == null || portfolioRate == null) {
    return <span className="font-mono text-[10px] text-os-dim">—</span>;
  }
  const deltaPoints = Math.round((clientRate - portfolioRate) * 100);
  if (deltaPoints === 0) {
    return <span className="font-mono text-[10px] text-os-dim">± 0 pp</span>;
  }
  const up = deltaPoints > 0;
  const tone = up
    ? 'border-[color-mix(in_oklab,var(--ok)_35%,transparent)] bg-[color-mix(in_oklab,var(--ok)_10%,transparent)] text-os-ok'
    : 'border-[color-mix(in_oklab,var(--err)_35%,transparent)] bg-[color-mix(in_oklab,var(--err)_10%,transparent)] text-os-err';
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-sm-t border px-1.5 py-[2px] font-mono text-[10px] font-semibold ${tone}`}>
      {up ? '▲' : '▼'} {up ? '+' : ''}
      {deltaPoints} pp
    </span>
  );
}

/** Each client's rate vs. the portfolio benchmark (aggregated-first — see
 * lib/analytics-portfolio.ts's buildPortfolioBenchmark). Delta is client rate
 * minus portfolio rate, in percentage points — never a ranking/score, just
 * the plain difference. Value and delta sit side by side (not stacked) so a
 * row scans left-to-right in one pass; the benchmark row itself is visually
 * distinct (darker fill, heavier top rule, a leading marker) so it reads as
 * the reference line, not just another client. */
export function BenchmarkTable({
  rows,
  benchmark,
}: {
  rows: ClientBenchmarkRow[];
  benchmark: PortfolioBenchmark;
}) {
  if (rows.length === 0) {
    return (
      <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
        Sin clientes todavía.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-os-border bg-os-surface2">
            <th className="px-3 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-os-dim">Cliente</th>
            <th className="px-3 py-2.5 text-right font-mono text-[9.5px] uppercase tracking-[0.14em] text-os-dim">Leads</th>
            {BENCHMARK_METRICS.map((metric) => (
              <th key={metric.key} className="px-3 py-2.5 text-right font-mono text-[9.5px] uppercase tracking-[0.14em] text-os-dim">
                {metric.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.clientId} className="border-t border-os-border transition-colors hover:bg-os-surface2">
              <td className="px-3 py-3 font-mono text-[13px] font-bold text-os-text">{row.clientName}</td>
              <td className="px-3 py-3 text-right font-mono text-[11.5px] text-os-muted">{row.counts.leads}</td>
              {BENCHMARK_METRICS.map((metric) => (
                <td key={metric.key} className="px-3 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <span className="font-mono text-[13px] font-semibold text-os-text">{formatRate(row[metric.key] as number | null)}</span>
                    <DeltaTag clientRate={row[metric.key] as number | null} portfolioRate={benchmark[metric.key] as number | null} />
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-os-text bg-os-bg2">
            <td className="px-3 py-3 font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-os-text">
              ◆ Benchmark de cartera
            </td>
            <td className="px-3 py-3 text-right font-mono text-[12px] font-bold text-os-text">{benchmark.totals.leads}</td>
            {BENCHMARK_METRICS.map((metric) => (
              <td key={metric.key} className="px-3 py-3 text-right font-mono text-[13.5px] font-bold text-os-text">
                {formatRate(benchmark[metric.key] as number | null)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ===== Acquisition by source (CRM leads only — never MetaCampaign leads) =====

export function SourceAcquisitionTable({ rows }: { rows: SourceAcquisitionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
        Sin leads todavía.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-os-border bg-os-surface2">
            <th className="px-3 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-os-dim">Origen (CRM)</th>
            <th className="px-3 py-2.5 text-right font-mono text-[9.5px] uppercase tracking-[0.14em] text-os-dim">Leads</th>
            <th className="px-3 py-2.5 text-right font-mono text-[9.5px] uppercase tracking-[0.14em] text-os-dim">Cualificación</th>
            <th className="px-3 py-2.5 text-right font-mono text-[9.5px] uppercase tracking-[0.14em] text-os-dim">Conversión</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.source} className="border-t border-os-border transition-colors hover:bg-os-surface2">
              <td className="px-3 py-3 font-mono text-[13px] font-bold text-os-text">{row.source}</td>
              <td className="px-3 py-3 text-right font-mono text-[11.5px] text-os-muted">{row.leads}</td>
              <td className="px-3 py-3 text-right font-mono text-[12.5px] font-semibold text-os-text">{formatRate(row.qualificationRate)}</td>
              <td className="px-3 py-3 text-right font-mono text-[12.5px] font-semibold text-os-text">{formatRate(row.conversionRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ===== Coverage meter (configuration % — never mixed with verification) =====

export function CoverageMeter({ label, percent, hint }: { label: string; percent: number | null; hint: string }) {
  return (
    <div className="border border-os-border bg-os-surface px-4 py-3.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{label}</div>
      <div className="mt-1.5 font-mono text-[30px] font-bold leading-none tracking-tight text-os-text">
        {percent == null ? '—' : `${percent}%`}
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden border border-os-border bg-os-surface2">
        <div className="h-full bg-os-accent opacity-70" style={{ width: `${percent ?? 0}%` }} />
      </div>
      <div className="mt-1.5 font-mono text-[9px] leading-snug text-os-dim">{hint}</div>
    </div>
  );
}

// ===== Opportunities / risks feed =====

const FINDING_CATEGORY_LABEL: Record<PortfolioFinding['category'], string> = {
  meta_budget_no_campaign: 'Presupuesto sin campaña',
  integration_requirement_pending: 'Integración pendiente',
  automation_needs_attention: 'Automatización — atención',
  automation_never_run: 'Automatización — sin ejecutar',
  agent_config_incomplete: 'Agente IA — configuración incompleta',
  integration_verification_failed: 'Integración — incidencia',
};

/** Compact analytical cards, not a raw log: category, affected client/entity
 * and the finding text are each their own scannable field. No severity,
 * urgency or financial-impact language is added — every card renders the
 * same deterministic template the underlying finding already carries. */
export function FindingsList({ findings }: { findings: PortfolioFinding[] }) {
  if (findings.length === 0) {
    return (
      <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
        Sin hallazgos — no se detectan huecos operativos con los datos actuales.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
      {findings.map((finding) => (
        <div key={finding.id} className="border border-os-border bg-os-surface p-3.5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-block border border-os-border-strong bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-os-dim">
              {FINDING_CATEGORY_LABEL[finding.category]}
            </span>
            <span className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.05em] text-os-muted">
              {finding.clientName ?? 'REKREATIVE (interno)'}
            </span>
          </div>
          <p className="text-[12px] leading-snug text-os-text">{finding.message}</p>
        </div>
      ))}
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { BusinessSeries, IncomeRange, MonthPoint } from '@/lib/bank-statements';

const RANGES: { label: string; value: IncomeRange }[] = [
  { label: '30 días', value: 1 },
  { label: '60 días', value: 2 },
  { label: '3 meses', value: 3 },
  { label: '6 meses', value: 6 },
  { label: '12 meses', value: 12 },
  { label: 'Todo', value: 'all' },
];

/** What the card plots: deposits, outflow, or what's left after outflow. */
type Metric = 'in' | 'out' | 'net';
const METRICS: { label: string; value: Metric }[] = [
  { label: 'Ingresos', value: 'in' },
  { label: 'Gastos', value: 'out' },
  { label: 'Neto tras gastos', value: 'net' },
];
const metricCents = (m: MonthPoint, metric: Metric): number =>
  metric === 'in' ? m.creditsCents : metric === 'out' ? m.debitsCents : m.netCents;

// REKREATIVE's internal finance view presents every value in EUR — same
// display convention as app/finances/page.tsx's eur().
const eur = (cents: number) =>
  `${(cents / 100).toLocaleString('es-ES', { maximumFractionDigits: 0, useGrouping: true })} €`;
const signedEur = (cents: number) => `${cents < 0 ? '−' : '+'}${eur(Math.abs(cents))}`;
const fmtMonth = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('es-ES', { month: 'short', timeZone: 'UTC' });

/** Per-business bank-statement money with range + metric dropdowns — money
    in (deposits), money out (outflow), or the net that's left after it, as a
    total over the window plus monthly bars. Statements are monthly, 30d≈1mo. */
export function BusinessIncomeChart({ series }: { series: BusinessSeries }) {
  const [range, setRange] = useState<IncomeRange>('all');
  const [metric, setMetric] = useState<Metric>('in');
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = range === 'all' ? series.months : series.months.slice(-range);
  const totalIn = shown.reduce((s, m) => s + m.creditsCents, 0);
  const totalOut = shown.reduce((s, m) => s + m.debitsCents, 0);
  const net = shown.reduce((s, m) => s + m.netCents, 0);
  const total = metric === 'in' ? totalIn : metric === 'out' ? totalOut : net;
  const max = Math.max(1, ...shown.map((m) => Math.abs(metricCents(m, metric))));

  const headlineClass =
    metric === 'in' ? 'text-os-ok' : metric === 'out' ? 'text-os-err' : net >= 0 ? 'text-os-ok' : 'text-os-err';
  const subLabel =
    metric === 'in' ? (
      <span className={`font-mono text-[11px] ${net >= 0 ? 'text-os-ok' : 'text-os-err'}`}>{signedEur(net)} neto</span>
    ) : metric === 'out' ? (
      <span className="font-mono text-[11px] text-os-dim">de {eur(totalIn)} ingresos</span>
    ) : (
      <span className="font-mono text-[11px] text-os-dim">
        {eur(totalIn)} ingresos − {eur(totalOut)} gastos
      </span>
    );

  return (
    <div className="rounded-lg-t border border-os-border bg-os-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{series.business}</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-os-dim">
            {metric === 'in' ? 'ingresos · depósitos bancarios' : metric === 'out' ? 'gastos · cargos bancarios' : 'neto · tras gastos'}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
            className="rounded-sm-t border border-os-border bg-os-bg px-2 py-1 font-mono text-[10px] text-os-muted focus:border-os-border-strong focus:outline-none"
          >
            {METRICS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <select
            value={String(range)}
            onChange={(e) => setRange(e.target.value === 'all' ? 'all' : (Number(e.target.value) as IncomeRange))}
            className="rounded-sm-t border border-os-border bg-os-bg px-2 py-1 font-mono text-[10px] text-os-muted focus:border-os-border-strong focus:outline-none"
          >
            {RANGES.map((r) => (
              <option key={r.label} value={String(r.value)}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className={`font-mono text-[26px] font-semibold tracking-[-0.02em] ${headlineClass}`}>
          {metric === 'net' && net < 0 ? `−${eur(Math.abs(net))}` : eur(total)}
        </span>
        {subLabel}
      </div>

      {shown.length === 0 ? (
        <div className="mt-4 font-mono text-[11px] text-os-dim">sin extractos en este rango</div>
      ) : (
        <div className="mt-4 flex items-end gap-1.5" style={{ height: 104 }}>
          {shown.map((m) => {
            const hot = hovered === m.month;
            const cents = metricCents(m, metric);
            const h = Math.max(2, (Math.abs(cents) / max) * 76);
            // in = accent · out = red · net = green/red by the month's sign
            const barClass =
              metric === 'in' ? 'bg-os-accent' : metric === 'out' ? 'bg-os-err' : cents >= 0 ? 'bg-os-ok' : 'bg-os-err';
            return (
              <div
                key={m.month}
                className="flex flex-1 flex-col items-center gap-1"
                onMouseEnter={() => setHovered(m.month)}
                onMouseLeave={() => setHovered(null)}
              >
                <div className="relative flex w-full items-end justify-center" style={{ height: 84 }}>
                  {/* the month's number rises out of the bar on hover */}
                  {hot && (
                    <span
                      className="fin-tip pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-sm-t border border-os-border-strong bg-os-surface2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-os-text"
                      style={{ bottom: `${h + 6}px` }}
                    >
                      {metric === 'net' ? signedEur(cents) : eur(cents)}
                    </span>
                  )}
                  <div
                    className={`w-full max-w-[28px] rounded-sm-t transition-[opacity,filter] duration-150 ${barClass}`}
                    style={{ height: `${h}px`, opacity: hot ? 1 : hovered ? 0.45 : 0.8 }}
                  />
                </div>
                <span className={`font-mono text-[9px] transition-colors duration-150 ${hot ? 'text-os-text' : 'text-os-dim'}`}>
                  {fmtMonth(m.month)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

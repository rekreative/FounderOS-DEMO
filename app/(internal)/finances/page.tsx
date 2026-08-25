import Link from 'next/link';
import { ArrowDownLeft, ArrowUpRight, Scale, Landmark, Send } from 'lucide-react';
import { configuredProcessors, monthToDateIncome, stripeSnapshot, wiseOutgoing } from '@/lib/connectors/payments';
import { incomeAccounts, observedIncome, currentMonthKey, monthlyExpenseTotal, netForMonth } from '@/lib/finances';
import { openLedger } from '@/lib/ledger';
import { openBankStore } from '@/lib/bank';
import { businessSeries } from '@/lib/bank-statements';
import { PageHeader } from '@/components/PageHeader';
import { SharePie } from '@/components/SharePie';
import { StatementUploader } from '@/components/StatementUploader';
import { BusinessIncomeChart } from '@/components/BusinessIncomeChart';
import { Badge, Label, SectionHead } from '@/components/terminal';

export const dynamic = 'force-dynamic';

// REKREATIVE's internal finance view presents every value in EUR — this is a
// display convention only (see lib/finances.ts's IncomeAccount.income doc),
// no FX conversion happens anywhere. `cents` widens to 2 decimals for
// sub-euro-precision figures (e.g. a real Stripe balance in cents).
const eur = (n: number, cents = false) =>
  `${n.toLocaleString('es-ES', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
    useGrouping: true,
  })} €`;

function ago(unix: number): string {
  const mins = Math.round((Date.now() - unix * 1000) / 60_000);
  if (mins < 60) return `${Math.max(0, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default async function FinancesPage() {
  const stripeKeyed = configuredProcessors(process.env).some((p) => p.id === 'stripe' && p.configured);

  // Stripe is only "live" when the API actually answers — a present-but-invalid
  // key (or a server env missing it) stays honest pending, never a fake live.
  let stripeLive = false;
  let mtdUsd: number | null = null;
  let available = 0;
  let pending = 0;
  let recent: { amount: number; currency: string; description: string; created: number }[] = [];
  if (stripeKeyed) {
    const [mtd, snap] = await Promise.all([
      monthToDateIncome().catch(() => null),
      stripeSnapshot().catch(() => null),
    ]);
    if (snap) {
      stripeLive = true;
      available = (snap.available[0]?.amount ?? 0) / 100;
      pending = (snap.pending[0]?.amount ?? 0) / 100;
      recent = snap.recentCharges;
    }
    mtdUsd = mtd ? mtd.amountCents / 100 : null;
  }

  // Which processors have keys (honest config), so non-Stripe cards show
  // "clave configurada · sincronización pendiente" vs "conectar →" rather
  // than a misleading live badge. configuredProcessors() still reports the
  // full processor registry (FanBasis, both Wise accounts, etc.) — that
  // architecture is untouched; incomeAccounts() simply no longer renders a
  // row for every one of them by default (see its own doc comment).
  const configuredMap = Object.fromEntries(configuredProcessors(process.env).map((p) => [p.id, p.configured]));
  const accounts = incomeAccounts({ connected: stripeLive, mtdUsd }, configuredMap);
  // Outgoing Wise transfers — null (no Wise key) hides the section entirely.
  const wiseOut = await wiseOutgoing(process.env).catch(() => null);
  // "No observed income source" ≠ "observed income = 0" — null unless at
  // least one processor is actually live (config-only PayPal/Wise never
  // count). Once one is live, 0 is a valid real MTD figure, same as any
  // positive total.
  const incomeMtd = observedIncome(accounts);

  // Current-month expenses — ONLY real imported ledger rows for THIS calendar
  // month (resolved server-side, never from whatever month the ledger's
  // latestMonth() happens to be, and never a fallback to demo data). No rows
  // for this month → expenses stays null, rendered as an honest "—", never a
  // faked/demo number standing in for it.
  const currentMonth = currentMonthKey(new Date());
  let ledgerSpend: { category: string; total: number }[] = [];
  try {
    const ledger = openLedger();
    ledgerSpend = ledger.monthlyFor(currentMonth);
    ledger.close();
  } catch {
    ledgerSpend = [];
  }
  const expensesLive = ledgerSpend.length > 0;
  const expenses = monthlyExpenseTotal(ledgerSpend);
  // Net only exists when BOTH operands are real for the same calendar month —
  // never against a fabricated 0 stand-in for a missing income source or a
  // missing expense import, and never a SAMPLE_EXPENSES stand-in.
  const netMonthly = netForMonth(incomeMtd, expenses);
  const netUnavailableReason =
    incomeMtd == null && expenses == null
      ? 'ingresos y gastos no disponibles'
      : incomeMtd == null
        ? 'sin ingresos conectados'
        : 'gastos no importados';
  // "2026-06" → "jun 2026" for the current period's label, shown whether or
  // not anything was imported for it.
  const monthLabel = new Date(`${currentMonth}-01T00:00:00Z`).toLocaleDateString('es-ES', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  // Per-business income from uploaded bank statements — a SEPARATE imported
  // source. Deliberately never folded into incomeMtd/netMonthly above: a
  // processor payout can later also land as a bank deposit, so combining both
  // would risk double-counting the same money as income twice.
  let bankSeries: ReturnType<typeof businessSeries> = [];
  try {
    const bank = openBankStore();
    bankSeries = businessSeries(bank.all());
    bank.close();
  } catch {
    bankSeries = [];
  }

  const liveCount = accounts.filter((a) => a.live).length;
  const maxAccount = Math.max(...accounts.map((a) => a.income ?? 0), 1);
  const maxCategory = Math.max(...ledgerSpend.map((c) => c.total), 1);

  return (
    <div>
      <PageHeader
        eyebrow="REKREATIVE FINANZAS"
        title="Finanzas"
        right={
          netMonthly != null ? (
            <Badge tone={netMonthly >= 0 ? 'ok' : 'err'}>
              {netMonthly >= 0 ? '+' : '−'}
              {eur(Math.abs(netMonthly))} neto/mes
            </Badge>
          ) : (
            <Badge ghost>neto/mes — {netUnavailableReason}</Badge>
          )
        }
      />
      <p className="-mt-4 mb-5 max-w-xl text-[12px] text-os-muted">Visión financiera interna de REKREATIVE.</p>

      {/* Scope note — Finances is REKREATIVE-level processor income, distinct
          from Resultados' per-client attributed revenue. The two are never
          meant to reconcile: different granularity, different question. Also
          spells out the processor/bank-statement split (see the "Ingresos ·
          por negocio" section below) so neither reads as included in the other. */}
      <div className="mb-5 border border-dashed border-os-border bg-os-surface2 px-3 py-2 font-mono text-[10px] text-os-dim">
        Ingresos por procesador a nivel de REKREATIVE (todos los clientes). Para ingresos atribuidos por cliente, consulta{' '}
        <Link href="/results" className="text-os-muted underline decoration-dotted hover:text-os-accent">
          Resultados
        </Link>
        . Los extractos bancarios importados se muestran aparte y no se suman aquí, para no contar el mismo ingreso dos veces.
      </div>

      {/* Summary tiles — slim single-line rows so the page opens condensed */}
      <section className="mb-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col gap-1 rounded-lg-t border border-os-border bg-os-surface px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Ingresos · mes</Label>
            <ArrowDownLeft className="h-3 w-3 text-os-ok" strokeWidth={1.8} />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`font-mono text-[16px] font-semibold leading-none tracking-[-0.02em] ${incomeMtd != null ? 'text-os-ok' : 'text-os-dim'}`}
            >
              {incomeMtd != null ? eur(incomeMtd) : '—'}
            </span>
            <span className="min-w-0 truncate font-mono text-[9.5px] uppercase tracking-[0.1em] text-os-dim">
              {incomeMtd != null ? `procesadores · ${liveCount}/${accounts.length} conectados` : 'sin fuentes de ingreso conectadas'}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1 rounded-lg-t border border-os-border bg-os-surface px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Gastos · mes</Label>
            <ArrowUpRight className="h-3 w-3 text-os-err" strokeWidth={1.8} />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={`font-mono text-[16px] font-semibold leading-none tracking-[-0.02em] ${expensesLive ? '' : 'text-os-dim'}`}
            >
              {expenses != null ? eur(expenses) : '—'}
            </span>
            <span
              className={`min-w-0 truncate font-mono text-[9.5px] uppercase tracking-[0.1em] ${expensesLive ? 'text-os-ok' : 'text-os-warn'}`}
            >
              {expensesLive ? `importado · ${monthLabel}` : `sin importar · ${monthLabel}`}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1 rounded-lg-t border border-os-border bg-os-surface px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Neto · mes</Label>
            <Scale className="h-3 w-3 text-os-accent" strokeWidth={1.8} />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            {netMonthly != null ? (
              <span
                className={`font-mono text-[16px] font-semibold leading-none tracking-[-0.02em] ${netMonthly >= 0 ? 'text-os-ok' : 'text-os-err'}`}
              >
                {netMonthly >= 0 ? '' : '−'}
                {eur(Math.abs(netMonthly))}
              </span>
            ) : (
              <span className="font-mono text-[16px] font-semibold leading-none tracking-[-0.02em] text-os-dim">—</span>
            )}
            <span className="min-w-0 truncate font-mono text-[9.5px] uppercase tracking-[0.1em] text-os-dim">
              {netMonthly != null ? 'ingresos − gastos' : netUnavailableReason}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1 rounded-lg-t border border-os-border bg-os-surface px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Saldo Stripe</Label>
            <Landmark className="h-3 w-3 text-os-accent" strokeWidth={1.8} />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[16px] font-semibold leading-none tracking-[-0.02em]">
              {stripeLive ? eur(available, true) : '—'}
            </span>
            <span className="min-w-0 truncate font-mono text-[9.5px] uppercase tracking-[0.1em] text-os-dim">
              {stripeLive ? `${eur(pending, true)} pendiente` : 'conectar Stripe'}
            </span>
          </div>
        </div>
      </section>

      {/* Income by processor */}
      {/* Income by business — from uploaded bank statements, with a range dropdown */}
      {bankSeries.length > 0 && (
        <section className="mb-5">
          <SectionHead label="Ingresos · por negocio" count="depósitos bancarios" />
          <p className="-mt-1 mb-3 font-mono text-[10px] text-os-dim">
            Extractos bancarios importados · no incluido en Ingresos · mes ni en Neto · mes (evita contar el mismo ingreso dos veces).
          </p>
          <div className="grid gap-3.5 lg:grid-cols-2">
            {bankSeries.map((s) => (
              <BusinessIncomeChart key={s.business} series={s} />
            ))}
          </div>
        </section>
      )}

      {/* Monthly expenses by category — real imported ledger rows for the
          current month only. No SAMPLE_EXPENSES fallback: an empty month
          renders an honest empty state, never demo numbers standing in for
          operational truth. */}
      <section className="mb-5">
        <SectionHead
          label="Gastos mensuales · por categoría"
          count={expensesLive ? `${eur(expenses ?? 0)} · ${monthLabel}` : `sin importar · ${monthLabel}`}
        />
        {expensesLive ? (
          <div className="grid items-stretch gap-3.5 lg:grid-cols-[1.15fr_1fr_0.85fr]">
            {/* where the money goes — share per category */}
            <SharePie
              items={ledgerSpend.map((c) => ({ key: c.category, label: c.category, value: Math.round(c.total * 100) }))}
              total={Math.round((expenses ?? 0) * 100)}
              centerLabel={monthLabel}
              format={(cents) => eur(cents / 100)}
              donutPx={190}
              ariaLabel="Gastos mensuales por categoría"
            />

            <div className="rounded-lg-t border border-os-border bg-os-surface p-4">
              <div className="flex flex-col gap-2.5">
                {ledgerSpend.map((c) => (
                  <div key={c.category}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 font-mono text-[11px]">
                      <span className="text-os-muted">{c.category}</span>
                      <span className="text-os-text">{eur(c.total)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-sm-t bg-os-surface2">
                      <div className="h-full bg-os-accent opacity-60" style={{ width: `${(c.total / maxCategory) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Statement ingestion — upload a CSV to add more current-month spend */}
            <StatementUploader />
          </div>
        ) : (
          <div className="grid items-stretch gap-3.5 lg:grid-cols-[1.6fr_0.85fr]">
            <div className="flex items-center rounded-lg-t border border-dashed border-os-border bg-os-surface2 px-4 py-6 font-mono text-[11px] text-os-dim">
              Sin gastos importados para {monthLabel}. Sube un extracto de este mes para ver el desglose real.
            </div>
            {/* Statement ingestion — upload a CSV to populate this month */}
            <StatementUploader />
          </div>
        )}
      </section>

      <section className="mb-5">
        <SectionHead label="Ingresos · por procesador" count={`${liveCount}/${accounts.length} conectados`} />
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => (
            <div key={a.id} className="hoverable rounded-lg-t border border-os-border bg-os-surface px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-semibold">{a.label}</div>
                  <div className="mt-0.5 font-mono text-[9.5px] text-os-dim">{a.processor}</div>
                </div>
                {a.live ? (
                  <Badge tone="ok">
                    <span className="dot ok pulse mr-1 inline-block" /> conectado
                  </Badge>
                ) : a.configured ? (
                  <Badge tone="warn">clave configurada · sin integración</Badge>
                ) : (
                  <Badge ghost>conectar →</Badge>
                )}
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-mono text-[18px] font-semibold tracking-[-0.02em]">
                  {a.income != null ? eur(a.income) : '—'}
                </span>
                {/* "clave configurada" alone never implies live data — this
                    processor has no working pull yet, so income stays a
                    permanent "—" until real integration code exists. */}
                <span className="font-mono text-[9.5px] text-os-dim">
                  {a.live ? 'este mes' : a.configured ? 'sin datos en vivo' : 'sin conectar'}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-sm-t bg-os-surface2">
                <div
                  className="h-full bg-os-accent opacity-60"
                  style={{ width: `${a.income != null ? (a.income / maxAccount) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Outgoing transfers — Wise (hidden entirely until a Wise key lands).
          Real per-transfer currency (t.currency) is preserved honestly —
          only the locale/grouping style is es-ES, never forced to € for a
          transfer that isn't actually in euros. */}
      {wiseOut && (
        <section className="mb-5">
          <SectionHead label="Salidas · Wise" count={`${wiseOut.length} transferencia${wiseOut.length === 1 ? '' : 's'}`} />
          {wiseOut.length === 0 ? (
            <div className="rounded-lg-t border border-os-border bg-os-surface px-4 py-3 font-mono text-[11px] text-os-dim">
              Wise conectado · sin transferencias salientes recientes
            </div>
          ) : (
            <ul className="space-y-1.5">
              {wiseOut.map((t, i) => (
                <li
                  key={`${t.created}-${i}`}
                  className="hoverable flex items-center gap-3.5 rounded-lg-t border border-os-border bg-os-surface px-4 py-3"
                >
                  <Send className="h-[15px] w-[15px] shrink-0 text-os-err" strokeWidth={1.8} />
                  <span className="font-mono text-[15px] font-semibold text-os-err">
                    −{(t.amountCents / 100).toLocaleString('es-ES', { style: 'currency', currency: t.currency })}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-os-muted">{t.reference ?? t.status}</span>
                  <span className="shrink-0 font-mono text-[11px] text-os-dim">{t.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Recent income — real Stripe charges */}
      {stripeLive && recent.length > 0 && (
        <section>
          <SectionHead label="Ingresos recientes" count="Stripe · conectado" />
          <ul className="space-y-1.5">
            {recent.map((c, i) => (
              <li
                key={`${c.created}-${i}`}
                className="hoverable flex items-center gap-3.5 rounded-lg-t border border-os-border bg-os-surface px-4 py-3"
              >
                <span className="font-mono text-[15px] font-semibold text-os-ok">+{eur(c.amount / 100, true)}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-os-muted">{c.description}</span>
                <span className="shrink-0 font-mono text-[11px] text-os-dim">{ago(c.created)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

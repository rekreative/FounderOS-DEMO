/**
 * Finances domain — pure, real-ready. Income flows through a processor/account
 * registry (Stripe wired today; PayPal, FanBasis ×2, Wise ×2 are honest pending
 * slots until their keys land). Expenses are seeded SAMPLE data until the
 * statement-ingestion engine (Phase 2) replaces them with parsed bank/CC rows.
 *
 * No faked money: an unwired account reports null income, never a zero that
 * reads as "earned nothing". The page renders pending honestly.
 */

// ── Income: processor / account registry ────────────────────────────────────

export type IncomeAccount = {
  id: string;
  processor: string; // 'Stripe' | 'PayPal' | 'FanBasis' | 'Wise'
  label: string; // display label, incl. the account for multi-account processors
  configured: boolean; // does this account have credentials in the env?
  live: boolean; // actually pulling real income right now (Stripe only, for now)
  /** Month-to-date income, presented in EUR for REKREATIVE's internal view
   *  (null = pending). No FX conversion happens here — this is a display
   *  convention, not a currency model; see app/finances/page.tsx's eur(). */
  income: number | null;
};

/** Recent outgoing transfer (e.g. Wise) — REKREATIVE's own outgoing transfers. */
export type OutgoingTransfer = {
  amountCents: number;
  currency: string;
  status: string;
  created: string | number;
  reference?: string;
};

/**
 * The visible REKREATIVE demo account set: Stripe, PayPal, Wise — one row
 * each. Stripe carries its real month-to-date income when connected;
 * `configured` flags which accounts have keys in the env (from
 * `configuredProcessors`); `live` means a real pull is actually happening —
 * true only for Stripe today, so a key-set-but-not-yet-integrated account
 * reads "key set", never a faked number.
 *
 * This is a DEFAULT VISIBLE LIST, not the processor architecture: FanBasis
 * and the full multi-account registry (fanbasis-vantage/fanbasis-lc,
 * wise-1/wise-2) still exist and stay fully wired in
 * lib/connectors/payments.ts's configuredProcessors/fanbasisMonthToDateIncome
 * — only unnecessary for REKREATIVE's current, much simpler processor set to
 * show by default here. The `account` helper below is intentionally generic
 * (any id/processor/label) so a real second account — FanBasis or otherwise
 * — can be added back to this list later without changing its shape.
 */
export function incomeAccounts(
  stripe: { connected: boolean; mtdUsd: number | null },
  configured: Record<string, boolean> = {},
  liveIncomeUsd: Record<string, number> = {},
): IncomeAccount[] {
  // Non-Stripe accounts light up when a real month-to-date income is supplied;
  // otherwise they're honest pending.
  const account = (id: string, processor: string, label: string): IncomeAccount => {
    const live = liveIncomeUsd[id] != null;
    return {
      id,
      processor,
      label,
      configured: configured[id] ?? false,
      live,
      income: live ? liveIncomeUsd[id] : null,
    };
  };
  return [
    {
      id: 'stripe',
      processor: 'Stripe',
      label: 'Stripe · REKREATIVE',
      configured: configured.stripe ?? stripe.connected,
      live: stripe.connected,
      income: stripe.connected ? stripe.mtdUsd : null,
    },
    account('paypal', 'PayPal', 'PayPal · REKREATIVE'),
    // wise-1 is the sole visible Wise row — collapses the previous two
    // generic demo slots into one; its id/env var (WISE_1_TOKEN, see
    // configuredProcessors) is unchanged, so a real key still lights it up.
    account('wise-1', 'Wise', 'Wise · REKREATIVE'),
  ];
}

/** Total month-to-date income across accounts; pending (null) counts as zero. */
export function totalIncome(accounts: IncomeAccount[]): number {
  return accounts.reduce((sum, a) => sum + (a.income ?? 0), 0);
}

// ── Expenses: seeded sample until statement ingestion lands (Phase 2) ────────

export type ExpenseItem = { id: string; label: string; category: string; monthly: number };

/**
 * Placeholder recurring spend for an AI-operator / agency stack. Clearly a
 * SAMPLE in the UI — gets replaced by real parsed transactions once monthly
 * bank + credit-card statement uploads are wired.
 */
export const SAMPLE_EXPENSES: ExpenseItem[] = [
  { id: 'claude', label: 'Anthropic · Claude Max', category: 'Software', monthly: 200 },
  { id: 'openai', label: 'OpenAI · ChatGPT', category: 'Software', monthly: 20 },
  { id: 'cursor', label: 'Cursor', category: 'Software', monthly: 20 },
  { id: 'higgsfield', label: 'Higgsfield', category: 'Software', monthly: 39 },
  { id: 'elevenlabs', label: 'ElevenLabs', category: 'Software', monthly: 22 },
  { id: 'figma', label: 'Figma', category: 'Software', monthly: 15 },
  { id: 'notion', label: 'Notion', category: 'Software', monthly: 10 },
  { id: 'wispr', label: 'Wispr Flow', category: 'Software', monthly: 15 },
  { id: 'vercel', label: 'Vercel Pro', category: 'Infraestructura', monthly: 20 },
  { id: 'supabase', label: 'Supabase', category: 'Infraestructura', monthly: 25 },
  { id: 'domains', label: 'Domains & DNS', category: 'Infraestructura', monthly: 12 },
  { id: 'attio', label: 'Attio', category: 'CRM y ventas', monthly: 29 },
  { id: 'fathom', label: 'Fathom', category: 'CRM y ventas', monthly: 19 },
  { id: 'meta-ads', label: 'Meta Ads', category: 'Publicidad', monthly: 1500 },
  { id: 'editor', label: 'Video editor (contract)', category: 'Colaboradores', monthly: 1200 },
  { id: 'va', label: 'Virtual assistant', category: 'Colaboradores', monthly: 800 },
];

/** Sum of every recurring monthly cost. */
export function totalExpenses(items: ExpenseItem[]): number {
  return items.reduce((sum, e) => sum + e.monthly, 0);
}

/** Per-category totals, largest first. */
export function expensesByCategory(items: ExpenseItem[]): { category: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const e of items) totals.set(e.category, (totals.get(e.category) ?? 0) + e.monthly);
  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/** Net monthly cash flow — income minus expenses (may be negative). */
export function net(income: number, expenses: number): number {
  return income - expenses;
}

// ── Stripe month-to-date helpers (pure; the connector feeds in raw charges) ──

/** Unix seconds for the first instant of `now`'s calendar month (UTC). */
export function monthStartUnix(now: Date): number {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
}

/** Sum only the charges that actually settled (paid + succeeded). */
export function sumChargeIncome(
  charges: { amount: number; currency: string; paid: boolean; status: string }[],
): { amountCents: number; currency: string; count: number } {
  let amountCents = 0;
  let count = 0;
  let currency = 'usd';
  for (const c of charges) {
    if (c.paid && c.status === 'succeeded') {
      amountCents += c.amount;
      count += 1;
      currency = c.currency;
    }
  }
  return { amountCents, currency, count };
}

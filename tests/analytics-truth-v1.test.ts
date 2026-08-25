import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Analytics Truth V1 contract: AnalyticsBoard renders ONLY real,
 * PostgreSQL-backed, full-history CRM analytics (Clients/Leads/LeadEvents).
 * The legacy/demo-seeded localStorage stores (Meta campaigns, automations,
 * AI agents, integration connections/requirements) and the findings feed
 * built on top of them must never re-enter the render path — those stores
 * have no dataSource split in their aggregation, so presenting them as
 * operational Analytics would be dishonest. This test asserts that
 * boundary at the import level, the same way tests/code-splitting.test.ts
 * asserts the lazy-loading contract, so a future edit can't silently
 * reintroduce a demo import without breaking a test.
 */
describe('Analytics Truth V1 — legacy/demo isolation', () => {
  const board = read('components/AnalyticsBoard.tsx');

  test('AnalyticsBoard never imports the legacy/demo localStorage stores', () => {
    expect(board).not.toMatch(/from '@\/lib\/meta-ads'/);
    expect(board).not.toMatch(/from '@\/lib\/automations'/);
    expect(board).not.toMatch(/from '@\/lib\/agents-ai'/);
    expect(board).not.toMatch(/from '@\/lib\/integration-connections'/);
    expect(board).not.toMatch(/from '@\/lib\/client-integration-requirements'/);
  });

  test('AnalyticsBoard never calls the demo-fed portfolio helpers (campaign mix, automations, agents, integration coverage, findings, demo badge)', () => {
    expect(board).not.toMatch(/buildCampaignPortfolioMix/);
    expect(board).not.toMatch(/buildAutomationsOperationalSummary/);
    expect(board).not.toMatch(/buildAiAgentsConfigurationSummary/);
    expect(board).not.toMatch(/buildPortfolioIntegrationCoverage/);
    expect(board).not.toMatch(/buildOpportunitiesFeed/);
    expect(board).not.toMatch(/includesDemoPortfolioData/);
    expect(board).not.toMatch(/DemoDataBadge/);
  });

  test('AnalyticsBoard still renders the real canonical CRM analytics', () => {
    expect(board).toMatch(/from '@\/lib\/api\/leads'/);
    expect(board).toMatch(/buildPortfolioComposition/);
    expect(board).toMatch(/buildPortfolioBenchmark/);
    expect(board).toMatch(/buildClientBenchmarkRows/);
    expect(board).toMatch(/buildAcquisitionBySource/);
    expect(board).toMatch(/buildLeadIntentDistribution/);
    expect(board).toMatch(/PORTFOLIO_BENCHMARK_NOTE/);
  });

  test('AnalyticsBoard makes the full-history period semantics explicit', () => {
    expect(board).toMatch(/TODO EL HISTÓRICO/);
  });

  test('legacy/demo stores are isolated, not deleted', () => {
    // lib/meta-ads.ts: still depended on elsewhere (campaign CRUD, ClientMetaAdsPanel
    // legacy paths) — must not be removed just because Analytics stopped reading it.
    expect(existsSync(join(process.cwd(), 'lib/meta-ads.ts'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'lib/automations.ts'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'lib/agents-ai.ts'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'lib/integration-connections.ts'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'lib/client-integration-requirements.ts'))).toBe(true);

    // lib/analytics-portfolio.ts: the demo-fed helpers stay defined and exported
    // (Analytics V2 reconnects them once real Meta/operational telemetry exists)
    // even though AnalyticsBoard no longer imports them.
    const portfolio = read('lib/analytics-portfolio.ts');
    expect(portfolio).toMatch(/export function buildCampaignPortfolioMix/);
    expect(portfolio).toMatch(/export function buildAutomationsOperationalSummary/);
    expect(portfolio).toMatch(/export function buildAiAgentsConfigurationSummary/);
    expect(portfolio).toMatch(/export function buildPortfolioIntegrationCoverage/);
    expect(portfolio).toMatch(/export function buildOpportunitiesFeed/);
    expect(portfolio).toMatch(/export function includesDemoPortfolioData/);
  });

  test('Analytics never touches Finances/internal revenue', () => {
    expect(board).not.toMatch(/from '@\/lib\/finances'/);
    expect(board).not.toMatch(/Stripe|expenses|cash/i);
  });

  test('AnalyticsBoard no longer renders the unverified Meta budget KPIs', () => {
    // Client.metaBudgetMonthly is canonical PostgreSQL but its provenance is
    // unverifiable (seed rows carry the old demo constants verbatim, no
    // dataSource marker exists on the clients table) — see the provenance
    // audit. Both budget-derived KPI labels and their data fields must be
    // gone from the render path.
    expect(board).not.toMatch(/Presupuesto Meta contratado/);
    expect(board).not.toMatch(/Clientes con presupuesto/);
    expect(board).not.toMatch(/totalContractedMetaBudget/);
    expect(board).not.toMatch(/clientsWithBudget/);
    expect(board).not.toMatch(/formatEUR/);
  });

  test('the budget-derived fields stay defined in buildPortfolioComposition for later reuse', () => {
    // Not deleted, just unrendered — Analytics V2 (or a future dataSource-
    // verified budget field) can reconnect these without re-deriving them.
    const portfolio = read('lib/analytics-portfolio.ts');
    expect(portfolio).toMatch(/totalContractedMetaBudget/);
    expect(portfolio).toMatch(/clientsWithBudget/);
  });
});

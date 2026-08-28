import { describe, it, expect } from 'vitest';
import {
  buildAcquisitionBySource,
  buildAiAgentsConfigurationSummary,
  buildAutomationsOperationalSummary,
  buildCampaignPortfolioMix,
  buildClientBenchmarkRows,
  buildLeadIntentDistribution,
  buildOpportunitiesFeed,
  buildPerClientLeadFunnelCounts,
  buildPortfolioBenchmark,
  buildPortfolioComposition,
  buildPortfolioIntegrationCoverage,
  includesDemoPortfolioData,
} from '@/lib/analytics-portfolio';
import type { Client } from '@/lib/clients';
import type { Lead, LeadEvent } from '@/lib/leads';
import type { MetaCampaign } from '@/lib/meta-ads';
import type { Automation, AutomationRun } from '@/lib/automations';
import type { AiAgent } from '@/lib/agents-ai';
import type { IntegrationConnection } from '@/lib/integration-connections';
import type { ClientIntegrationRequirement } from '@/lib/client-integration-requirements';

// This suite runs under vitest's `node` environment (no window/localStorage) —
// same rationale as tests/results.test.ts / tests/automations.test.ts. Only
// pure derivation functions are exercised here.

function makeClient(overrides: Partial<Client> & Pick<Client, 'id'>): Client {
  return {
    name: 'Client',
    sector: 'E-commerce',
    status: 'active',
    service: 'Full-funnel Meta Ads',
    metaBudgetMonthly: 0,
    startDate: '2026-01-01',
    owner: 'Owner',
    ...overrides,
  };
}

function makeLead(overrides: Partial<Lead> & Pick<Lead, 'id' | 'clientId' | 'stage' | 'createdAt'>): Lead {
  return {
    scope: 'client',
    name: 'Lead',
    email: null,
    phone: null,
    whatsapp: null,
    source: 'Meta Ads',
    campaign: null,
    adCreative: null,
    form: null,
    lastActivityAt: overrides.createdAt,
    aiAnalysis: null,
    qualificationAnswers: null,
    appointmentDate: null,
    conversionValue: null,
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<MetaCampaign> & Pick<MetaCampaign, 'id' | 'clientId'>): MetaCampaign {
  return {
    scope: 'client',
    externalCampaignId: null,
    name: 'Campaign',
    status: 'active',
    objective: 'leads',
    budgetType: 'daily',
    dailyBudget: 50,
    lifetimeBudget: null,
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    leads: 0,
    startDate: '2026-01-01',
    endDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    dataSource: 'demo',
    ...overrides,
  };
}

function makeAutomation(overrides: Partial<Automation> & Pick<Automation, 'id' | 'clientId'>): Automation {
  return {
    scope: 'client',
    externalProvider: null,
    externalAutomationId: null,
    name: 'Automation',
    description: '',
    status: 'active',
    type: 'other',
    platforms: ['internal'],
    trigger: { platform: 'internal', event: 'x', description: 'x' },
    steps: [],
    lastRunAt: null,
    lastRunStatus: null,
    lastError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    dataSource: 'demo',
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> & Pick<AutomationRun, 'id' | 'automationId'>): AutomationRun {
  return {
    status: 'success',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:00.000Z',
    summary: '',
    error: null,
    source: 'system',
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AiAgent> & Pick<AiAgent, 'id'>): AiAgent {
  return {
    scope: 'client',
    clientId: 'client-a',
    name: 'Agent',
    role: 'Role',
    purpose: '',
    status: 'active',
    provider: 'openai',
    model: 'gpt',
    channel: 'whatsapp',
    useCase: 'lead_qualification',
    capabilities: [],
    instructions: 'Do things',
    knowledgeNotes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    dataSource: 'demo',
    ...overrides,
  };
}

function makeConnection(overrides: Partial<IntegrationConnection> & Pick<IntegrationConnection, 'id'>): IntegrationConnection {
  return {
    scope: 'client',
    clientId: 'client-a',
    platform: 'meta',
    name: 'Connection',
    verificationStatus: 'not_verified',
    verificationMethod: null,
    lastVerifiedAt: null,
    externalRef: null,
    externalLabel: null,
    notes: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    dataSource: 'demo',
    ...overrides,
  };
}

function makeRequirement(
  overrides: Partial<ClientIntegrationRequirement> & Pick<ClientIntegrationRequirement, 'id' | 'clientId' | 'platform'>,
): ClientIntegrationRequirement {
  return {
    requirement: 'required',
    connectionScope: 'client',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildPortfolioComposition', () => {
  it('groups by status/sector/service and sums the contracted budget', () => {
    const clients = [
      makeClient({ id: 'c1', status: 'active', sector: 'E-commerce', service: 'Full-funnel', metaBudgetMonthly: 1000, startDate: '2026-01-01' }),
      makeClient({ id: 'c2', status: 'active', sector: 'SaaS', service: 'Full-funnel', metaBudgetMonthly: 0, startDate: '2026-02-01' }),
      makeClient({ id: 'c3', status: 'paused', sector: 'E-commerce', service: 'Consulting', metaBudgetMonthly: 500, startDate: '2026-03-01' }),
    ];
    const now = new Date('2026-04-01T00:00:00.000Z');
    const composition = buildPortfolioComposition(clients, now);

    expect(composition.totalClients).toBe(3);
    expect(composition.byStatus.find((s) => s.status === 'active')?.count).toBe(2);
    expect(composition.byStatus.find((s) => s.status === 'paused')?.count).toBe(1);
    expect(composition.bySector.find((s) => s.key === 'E-commerce')?.count).toBe(2);
    expect(composition.byService.find((s) => s.key === 'Full-funnel')?.count).toBe(2);
    expect(composition.totalContractedMetaBudget).toBe(1500);
    expect(composition.clientsWithBudget).toBe(2);
    expect(composition.averageTenureDays).not.toBeNull();
  });

  it('returns null average tenure with zero clients, never a fabricated 0', () => {
    const composition = buildPortfolioComposition([], new Date('2026-04-01T00:00:00.000Z'));
    expect(composition.averageTenureDays).toBeNull();
    expect(composition.totalClients).toBe(0);
  });

  it('ignores unparseable startDates when averaging tenure', () => {
    const clients = [makeClient({ id: 'c1', startDate: 'not-a-date' })];
    const composition = buildPortfolioComposition(clients, new Date('2026-04-01T00:00:00.000Z'));
    expect(composition.averageTenureDays).toBeNull();
  });
});

describe('portfolio benchmark — aggregated-first, never averaged per-client', () => {
  // Client A: 1/1 qualified (100%). Client B: 1/100 qualified (1%). A naive
  // average of per-client rates would read ~50.5%; the honest aggregate is
  // 2 qualified / 101 leads ≈ 2%.
  const events: LeadEvent[] = [];
  const clientALeads = [makeLead({ id: 'a1', clientId: 'client-a', stage: 'qualified', createdAt: '2026-01-01T00:00:00.000Z' })];
  const clientBLeads = Array.from({ length: 100 }, (_, i) =>
    makeLead({ id: `b${i}`, clientId: 'client-b', stage: i === 0 ? 'qualified' : 'new', createdAt: '2026-01-01T00:00:00.000Z' }),
  );

  it('computes the portfolio rate from summed totals, not averaged percentages', () => {
    const perClientCounts = buildPerClientLeadFunnelCounts(
      [{ id: 'client-a' }, { id: 'client-b' }],
      [...clientALeads, ...clientBLeads],
      events,
    );
    const benchmark = buildPortfolioBenchmark(perClientCounts.map((c) => c.counts));

    expect(benchmark.totals.leads).toBe(101);
    expect(benchmark.totals.qualified).toBe(2);
    expect(benchmark.qualificationRate).toBeCloseTo(2 / 101);
    // A naive average of 100% and 1% (50.5%) must NOT be the result.
    expect(benchmark.qualificationRate).not.toBeCloseTo(0.505, 2);
  });

  it('renders null (not 0%) for a client with zero leads', () => {
    const rows = buildClientBenchmarkRows(
      [{ id: 'client-a', name: 'A' }, { id: 'client-empty', name: 'Empty' }],
      buildPerClientLeadFunnelCounts([{ id: 'client-a' }, { id: 'client-empty' }], clientALeads, events),
    );
    const empty = rows.find((r) => r.clientId === 'client-empty')!;
    expect(empty.counts.leads).toBe(0);
    expect(empty.qualificationRate).toBeNull();
    expect(empty.leadToAppointmentRate).toBeNull();
    expect(empty.closeRate).toBeNull();
  });

  it('leadToAppointmentRate is Leads -> Appointments directly, not Qualified -> Appointments', () => {
    const leads = [
      makeLead({ id: 'l1', clientId: 'client-a', stage: 'appointment', createdAt: '2026-01-01T00:00:00.000Z' }),
      makeLead({ id: 'l2', clientId: 'client-a', stage: 'new', createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const rows = buildClientBenchmarkRows(
      [{ id: 'client-a', name: 'A' }],
      buildPerClientLeadFunnelCounts([{ id: 'client-a' }], leads, events),
    );
    // 1 appointment out of 2 total leads = 0.5, not 1/1 (which bookingRate,
    // Qualified -> Appointments, would give since only 1 lead ever qualified).
    expect(rows[0].leadToAppointmentRate).toBeCloseTo(0.5);
  });
});

describe('buildAcquisitionBySource', () => {
  it('groups leads by source and computes rates distinctly per source', () => {
    const events: LeadEvent[] = [];
    const leads = [
      makeLead({ id: 'l1', clientId: 'client-a', stage: 'converted', createdAt: '2026-01-01T00:00:00.000Z', source: 'Meta Ads' }),
      makeLead({ id: 'l2', clientId: 'client-a', stage: 'new', createdAt: '2026-01-01T00:00:00.000Z', source: 'Meta Ads' }),
      makeLead({ id: 'l3', clientId: 'client-a', stage: 'converted', createdAt: '2026-01-01T00:00:00.000Z', source: 'Referral' }),
    ];
    const rows = buildAcquisitionBySource(leads, events);
    const meta = rows.find((r) => r.source === 'Meta Ads')!;
    const referral = rows.find((r) => r.source === 'Referral')!;

    expect(meta.leads).toBe(2);
    expect(meta.converted).toBe(1);
    expect(meta.conversionRate).toBeCloseTo(0.5);
    expect(referral.leads).toBe(1);
    expect(referral.conversionRate).toBeCloseTo(1);
  });
});

describe('buildLeadIntentDistribution', () => {
  it('separates analyzed from unanalyzed leads and tallies intent/priority', () => {
    const leads: Lead[] = [
      makeLead({
        id: 'l1',
        clientId: 'client-a',
        stage: 'new',
        createdAt: '2026-01-01T00:00:00.000Z',
        aiAnalysis: { summary: 's', intent: 'hot', priority: 'high', qualification: null, analyzedAt: '2026-01-01T00:00:00.000Z' },
      }),
      makeLead({
        id: 'l2',
        clientId: 'client-a',
        stage: 'new',
        createdAt: '2026-01-01T00:00:00.000Z',
        aiAnalysis: { summary: 's', intent: 'hot', priority: 'medium', qualification: null, analyzedAt: '2026-01-01T00:00:00.000Z' },
      }),
      makeLead({ id: 'l3', clientId: 'client-a', stage: 'new', createdAt: '2026-01-01T00:00:00.000Z', aiAnalysis: null }),
    ];
    const dist = buildLeadIntentDistribution(leads);

    expect(dist.analyzed).toBe(2);
    expect(dist.unanalyzed).toBe(1);
    expect(dist.byIntent.find((i) => i.intent === 'hot')?.count).toBe(2);
    expect(dist.byPriority.find((p) => p.priority === 'high')?.count).toBe(1);
  });
});

describe('buildAutomationsOperationalSummary', () => {
  it('buckets by health, computes run stats, and tallies platform/type', () => {
    const automations = [
      makeAutomation({ id: 'a1', clientId: 'client-a', platforms: ['make', 'whatsapp'], type: 'lead_response', lastRunAt: '2026-01-02T00:00:00.000Z', lastRunStatus: 'success' }),
      makeAutomation({ id: 'a2', clientId: 'client-a', platforms: ['make'], type: 'lead_response', lastRunAt: '2026-01-02T00:00:00.000Z', lastRunStatus: 'failed' }),
      makeAutomation({ id: 'a3', clientId: 'client-b', platforms: ['internal'], type: 'reporting', lastRunAt: null, lastRunStatus: null }),
    ];
    const runs = [
      makeRun({ id: 'r1', automationId: 'a1', status: 'success' }),
      makeRun({ id: 'r2', automationId: 'a2', status: 'failed' }),
    ];
    const summary = buildAutomationsOperationalSummary(automations, runs);

    expect(summary.total).toBe(3);
    expect(summary.healthy).toBe(1);
    expect(summary.needsAttention).toBe(1);
    expect(summary.neverRun).toBe(1);
    expect(summary.runStats.totalRuns).toBe(2);
    expect(summary.runStats.successRate).toBeCloseTo(0.5);
    expect(summary.byPlatform.find((p) => p.platform === 'make')?.count).toBe(2);
    expect(summary.byType.find((t) => t.type === 'lead_response')?.count).toBe(2);
  });
});

describe('buildAiAgentsConfigurationSummary', () => {
  it('never conflates status with configuration completeness', () => {
    const agents = [
      makeAgent({ id: 'ag1', status: 'active', instructions: 'Full setup' }),
      makeAgent({ id: 'ag2', status: 'active', instructions: null }), // active but incomplete
      makeAgent({ id: 'ag3', status: 'draft', instructions: null, provider: null, model: null }),
    ];
    const summary = buildAiAgentsConfigurationSummary(agents);

    expect(summary.total).toBe(3);
    expect(summary.active).toBe(2);
    expect(summary.draft).toBe(1);
    expect(summary.configComplete).toBe(1);
    expect(summary.configIncomplete).toBe(2);
    expect(summary.byProvider.find((p) => p.provider === 'openai')?.count).toBe(2);
  });
});

describe('buildPortfolioIntegrationCoverage', () => {
  it('aggregates coverage from summed totals, keeps verification separate, and satisfies internal requirements via shared connections', () => {
    const clients = [makeClient({ id: 'client-a' }), makeClient({ id: 'client-b' })];
    const requirements = [
      makeRequirement({ id: 'r1', clientId: 'client-a', platform: 'meta', requirement: 'required', connectionScope: 'client' }),
      makeRequirement({ id: 'r2', clientId: 'client-a', platform: 'openai', requirement: 'required', connectionScope: 'internal' }),
      makeRequirement({ id: 'r3', clientId: 'client-b', platform: 'meta', requirement: 'required', connectionScope: 'client' }),
    ];
    const connections = [
      // externalRef/externalLabel must be set for a client-scoped connection
      // to count as "configured" (see getIntegrationConfigurationStatus).
      makeConnection({
        id: 'con1',
        scope: 'client',
        clientId: 'client-a',
        platform: 'meta',
        externalRef: 'act_123',
        verificationStatus: 'verified',
      }),
      makeConnection({ id: 'con2', scope: 'internal', clientId: null, platform: 'openai', verificationStatus: 'not_verified' }),
      // client-b has no meta connection at all -> pending
      makeConnection({ id: 'con3', scope: 'client', clientId: 'client-b', platform: 'whatsapp', verificationStatus: 'failed' }),
    ];

    const coverage = buildPortfolioIntegrationCoverage(clients, requirements, connections);

    // client-a: 2/2 required configured (own meta + shared internal openai).
    // client-b: 0/1 required configured (meta missing).
    expect(coverage.totalRequired).toBe(3);
    expect(coverage.totalRequiredConfigured).toBe(2);
    expect(coverage.totalRequiredPending).toBe(1);
    expect(coverage.coveragePercent).toBe(Math.round((2 / 3) * 100));

    // Verification stays independent of configuration coverage.
    expect(coverage.totalConnections).toBe(3);
    expect(coverage.verifiedConnections).toBe(1);
    expect(coverage.notVerifiedConnections).toBe(1);
    expect(coverage.failedConnections).toBe(1);
  });

  it('returns null coveragePercent when there are zero required rows, never a fake 0/100', () => {
    const coverage = buildPortfolioIntegrationCoverage([makeClient({ id: 'client-a' })], [], []);
    expect(coverage.totalRequired).toBe(0);
    expect(coverage.coveragePercent).toBeNull();
  });
});

describe('buildCampaignPortfolioMix', () => {
  it('tallies by status and objective without touching spend', () => {
    const campaigns = [
      makeCampaign({ id: 'c1', clientId: 'client-a', status: 'active', objective: 'leads' }),
      makeCampaign({ id: 'c2', clientId: 'client-a', status: 'paused', objective: 'leads' }),
      makeCampaign({ id: 'c3', clientId: 'client-b', status: 'active', objective: 'traffic' }),
    ];
    const mix = buildCampaignPortfolioMix(campaigns);
    expect(mix.total).toBe(3);
    expect(mix.byStatus.find((s) => s.status === 'active')?.count).toBe(2);
    expect(mix.byObjective.find((o) => o.objective === 'leads')?.count).toBe(2);
  });
});

describe('buildOpportunitiesFeed', () => {
  it('flags a client with contracted Meta budget and no active campaign', () => {
    const findings = buildOpportunitiesFeed({
      clients: [makeClient({ id: 'client-a', name: 'Acme', metaBudgetMonthly: 1000 })],
      campaigns: [makeCampaign({ id: 'c1', clientId: 'client-a', status: 'paused' })],
      automations: [],
      agents: [],
      connections: [],
      requirements: [],
    });
    expect(findings.some((f) => f.category === 'meta_budget_no_campaign' && f.clientId === 'client-a')).toBe(true);
  });

  it('does not flag a client with budget and an active campaign', () => {
    const findings = buildOpportunitiesFeed({
      clients: [makeClient({ id: 'client-a', name: 'Acme', metaBudgetMonthly: 1000 })],
      campaigns: [makeCampaign({ id: 'c1', clientId: 'client-a', status: 'active' })],
      automations: [],
      agents: [],
      connections: [],
      requirements: [],
    });
    expect(findings.some((f) => f.category === 'meta_budget_no_campaign')).toBe(false);
  });

  it('flags pending required integrations, needs-attention and never-run automations, incomplete active agents, and failed verifications', () => {
    const findings = buildOpportunitiesFeed({
      clients: [makeClient({ id: 'client-a', name: 'Acme' })],
      campaigns: [],
      automations: [
        makeAutomation({ id: 'a1', clientId: 'client-a', name: 'Flow A', status: 'active', lastRunAt: '2026-01-01T00:00:00.000Z', lastRunStatus: 'failed' }),
        makeAutomation({ id: 'a2', clientId: 'client-a', name: 'Flow B', status: 'active', lastRunAt: null, lastRunStatus: null }),
        makeAutomation({ id: 'a3', clientId: 'client-a', name: 'Flow C (draft)', status: 'draft', lastRunAt: null, lastRunStatus: null }),
      ],
      agents: [
        makeAgent({ id: 'ag1', clientId: 'client-a', name: 'Agent Active Incomplete', status: 'active', instructions: null }),
        makeAgent({ id: 'ag2', clientId: 'client-a', name: 'Agent Draft', status: 'draft', instructions: null }),
      ],
      connections: [makeConnection({ id: 'con1', clientId: 'client-a', platform: 'meta', verificationStatus: 'failed' })],
      requirements: [makeRequirement({ id: 'r1', clientId: 'client-a', platform: 'whatsapp', requirement: 'required', connectionScope: 'client' })],
    });

    expect(findings.find((f) => f.category === 'integration_requirement_pending')).toBeTruthy();
    expect(findings.find((f) => f.category === 'automation_needs_attention' && f.id.includes('a1'))).toBeTruthy();
    expect(findings.find((f) => f.category === 'automation_never_run' && f.id.includes('a2'))).toBeTruthy();
    // Draft automation with no runs must never be flagged as never_run.
    expect(findings.find((f) => f.id.includes('a3'))).toBeFalsy();
    expect(findings.find((f) => f.category === 'agent_config_incomplete' && f.id.includes('ag1'))).toBeTruthy();
    // Draft agent's incomplete config is expected, not a finding.
    expect(findings.find((f) => f.id.includes('ag2'))).toBeFalsy();
    expect(findings.find((f) => f.category === 'integration_verification_failed')).toBeTruthy();
  });
});

describe('includesDemoPortfolioData', () => {
  it('is true when any touched source has a demo record', () => {
    expect(includesDemoPortfolioData({ campaigns: [makeCampaign({ id: 'c1', clientId: 'client-a', dataSource: 'demo' })] })).toBe(true);
    expect(includesDemoPortfolioData({ automations: [makeAutomation({ id: 'a1', clientId: 'client-a', dataSource: 'demo' })] })).toBe(true);
    expect(includesDemoPortfolioData({ agents: [makeAgent({ id: 'ag1', dataSource: 'demo' })] })).toBe(true);
    expect(includesDemoPortfolioData({ connections: [makeConnection({ id: 'con1', dataSource: 'demo' })] })).toBe(true);
  });

  it('is false when every touched source is manual', () => {
    expect(
      includesDemoPortfolioData({
        campaigns: [makeCampaign({ id: 'c1', clientId: 'client-a', dataSource: 'manual' })],
        automations: [makeAutomation({ id: 'a1', clientId: 'client-a', dataSource: 'manual' })],
        agents: [makeAgent({ id: 'ag1', dataSource: 'manual' })],
        connections: [makeConnection({ id: 'con1', dataSource: 'manual' })],
      }),
    ).toBe(false);
  });

  // A demo-sourced REKREATIVE-internal record is excluded from every client
  // metric above — it must not be the sole reason this badge shows either.
  it('is false when the only demo record is a REKREATIVE-internal campaign/automation/agent', () => {
    expect(
      includesDemoPortfolioData({
        campaigns: [makeCampaign({ id: 'c1', scope: 'internal', clientId: null, dataSource: 'demo' })],
        automations: [makeAutomation({ id: 'a1', scope: 'internal', clientId: null, dataSource: 'demo' })],
        agents: [makeAgent({ id: 'ag1', scope: 'internal', clientId: null, dataSource: 'demo' })],
      }),
    ).toBe(false);
  });

  // Connections are deliberately NOT scope-filtered here: an internal/shared
  // connection's demo-ness genuinely IS reflected in what Analytics renders
  // (Integraciones verification counts, shared-connection onboarding).
  it('is still true for a demo-sourced internal connection — it visibly affects the Integraciones section', () => {
    expect(includesDemoPortfolioData({ connections: [makeConnection({ id: 'con1', scope: 'internal', clientId: null, dataSource: 'demo' })] })).toBe(
      true,
    );
  });
});

// ── DATA-SCOPE CORRECTNESS: REKREATIVE-internal records must never leak
// into client-portfolio Analytics. Every test below uses a MIXED
// internal+client fixture so a leak reappearing later fails loudly. ────────

describe('client-portfolio scope correctness (internal REKREATIVE records excluded)', () => {
  const events: LeadEvent[] = [];

  it('1. internal REKREATIVE leads do not change client acquisition analytics (source rows + intent/priority distribution)', () => {
    const leads = [
      makeLead({ id: 'client-1', clientId: 'client-a', stage: 'converted', createdAt: '2026-01-01T00:00:00.000Z', source: 'Meta Ads' }),
      makeLead({ id: 'client-2', clientId: 'client-a', stage: 'new', createdAt: '2026-01-01T00:00:00.000Z', source: 'Meta Ads' }),
      // REKREATIVE's own internal lead — same source, would inflate "Meta Ads"
      // to 3 leads and the analyzed/unanalyzed split if it leaked in.
      makeLead({
        id: 'internal-1',
        scope: 'internal',
        clientId: null,
        stage: 'new',
        createdAt: '2026-01-01T00:00:00.000Z',
        source: 'Meta Ads',
        aiAnalysis: { summary: 's', intent: 'hot', priority: 'high', qualification: null, analyzedAt: '2026-01-01T00:00:00.000Z' },
      }),
    ];

    const bySource = buildAcquisitionBySource(leads, events);
    const meta = bySource.find((r) => r.source === 'Meta Ads')!;
    expect(meta.leads).toBe(2); // not 3
    expect(bySource.reduce((sum, r) => sum + r.leads, 0)).toBe(2);

    const dist = buildLeadIntentDistribution(leads);
    expect(dist.analyzed + dist.unanalyzed).toBe(2); // not 3
    expect(dist.analyzed).toBe(0); // the only analyzed lead was internal
    expect(dist.byIntent.length).toBe(0); // internal lead's 'hot' intent never counted
  });

  it('2. internal REKREATIVE Meta campaigns do not change portfolio campaign counts', () => {
    const campaigns = [
      makeCampaign({ id: 'c1', clientId: 'client-a', status: 'active', objective: 'leads' }),
      makeCampaign({ id: 'c2', clientId: 'client-b', status: 'active', objective: 'leads' }),
      makeCampaign({ id: 'c3', clientId: 'client-c', status: 'active', objective: 'leads' }),
      // REKREATIVE's own internal acquisition campaign — would make ACTIVA
      // read 4 instead of 3 if it leaked into the client portfolio mix.
      makeCampaign({ id: 'internal-c', scope: 'internal', clientId: null, status: 'active', objective: 'leads', name: 'REKREATIVE — Captación Centros de Psicología' }),
    ];
    const mix = buildCampaignPortfolioMix(campaigns);
    expect(mix.total).toBe(3);
    expect(mix.byStatus.find((s) => s.status === 'active')?.count).toBe(3);
  });

  it('3. internal REKREATIVE automations do not change client automation-health analytics (including run stats)', () => {
    const automations = [
      makeAutomation({ id: 'a1', clientId: 'client-a', lastRunAt: '2026-01-02T00:00:00.000Z', lastRunStatus: 'success' }),
      // Internal automation whose latest run FAILED — if its health/run stats
      // leaked in, client "needsAttention" and runStats would be wrong.
      makeAutomation({ id: 'internal-a', scope: 'internal', clientId: null, lastRunAt: '2026-01-02T00:00:00.000Z', lastRunStatus: 'failed' }),
    ];
    const runs = [
      makeRun({ id: 'r1', automationId: 'a1', status: 'success' }),
      makeRun({ id: 'r-internal', automationId: 'internal-a', status: 'failed' }),
    ];
    const summary = buildAutomationsOperationalSummary(automations, runs);

    expect(summary.total).toBe(1);
    expect(summary.healthy).toBe(1);
    expect(summary.needsAttention).toBe(0); // internal's failure excluded
    expect(summary.runStats.totalRuns).toBe(1); // internal's run excluded
    expect(summary.runStats.successRate).toBe(1); // would be 0.5 if the internal failed run leaked in
  });

  it('4. internal REKREATIVE agents do not change client-agent configuration analytics', () => {
    const agents = [
      makeAgent({ id: 'ag1', clientId: 'client-a', status: 'active', instructions: 'Full setup' }),
      // Internal agent, active with incomplete config — would inflate
      // configIncomplete/active counts if it leaked in.
      makeAgent({ id: 'internal-ag', scope: 'internal', clientId: null, status: 'active', instructions: null, provider: null, model: null }),
    ];
    const summary = buildAiAgentsConfigurationSummary(agents);

    expect(summary.total).toBe(1);
    expect(summary.active).toBe(1);
    expect(summary.configComplete).toBe(1);
    expect(summary.configIncomplete).toBe(0); // internal agent's incompleteness excluded
  });

  it('5. a shared internal Make/OpenAI-style connection still satisfies a client integration requirement (the valid exception)', () => {
    const clients = [makeClient({ id: 'client-a' })];
    const requirements = [makeRequirement({ id: 'r1', clientId: 'client-a', platform: 'openai', requirement: 'required', connectionScope: 'internal' })];
    const connections = [
      makeConnection({ id: 'shared-openai', scope: 'internal', clientId: null, platform: 'openai', verificationStatus: 'not_verified' }),
    ];
    const coverage = buildPortfolioIntegrationCoverage(clients, requirements, connections);
    expect(coverage.totalRequiredConfigured).toBe(1); // satisfied by the shared connection
    expect(coverage.totalRequiredPending).toBe(0);
  });

  it("6. another client's owned connection cannot satisfy a different client's owned (non-shared) requirement", () => {
    const clients = [makeClient({ id: 'client-a' }), makeClient({ id: 'client-b' })];
    const requirements = [makeRequirement({ id: 'r1', clientId: 'client-a', platform: 'meta', requirement: 'required', connectionScope: 'client' })];
    const connections = [
      // Owned by client-b, not client-a, and not internal/shared.
      makeConnection({ id: 'con-b', scope: 'client', clientId: 'client-b', platform: 'meta', externalRef: 'act_999', verificationStatus: 'verified' }),
    ];
    const coverage = buildPortfolioIntegrationCoverage(clients, requirements, connections);
    expect(coverage.totalRequiredConfigured).toBe(0);
    expect(coverage.totalRequiredPending).toBe(1); // client-a's requirement stays unmet
  });

  it('7. the portfolio benchmark aggregates client totals first, excluding internal REKREATIVE leads from the denominator', () => {
    const leads = [
      makeLead({ id: 'client-1', clientId: 'client-a', stage: 'converted', createdAt: '2026-01-01T00:00:00.000Z' }),
      makeLead({ id: 'client-2', clientId: 'client-a', stage: 'new', createdAt: '2026-01-01T00:00:00.000Z' }),
      // An internal lead that is ALSO 'converted' — if it leaked into the
      // per-client cohort it would skew the aggregate qualification/close rate.
      makeLead({ id: 'internal-1', scope: 'internal', clientId: null, stage: 'converted', createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const perClientCounts = buildPerClientLeadFunnelCounts([{ id: 'client-a' }], leads, events);
    const benchmark = buildPortfolioBenchmark(perClientCounts.map((c) => c.counts));

    expect(benchmark.totals.leads).toBe(2); // not 3
    expect(benchmark.totals.converted).toBe(1); // not 2
    expect(benchmark.closeRate).toBeCloseTo(0.5); // 1/2, not 2/3
  });

  it('opportunities feed never generates a client-portfolio finding from an internal REKREATIVE automation/agent/connection', () => {
    const findings = buildOpportunitiesFeed({
      clients: [makeClient({ id: 'client-a', name: 'Acme' })],
      campaigns: [],
      automations: [
        makeAutomation({ id: 'internal-a', scope: 'internal', clientId: null, name: 'Internal flow', status: 'active', lastRunAt: '2026-01-01T00:00:00.000Z', lastRunStatus: 'failed' }),
      ],
      agents: [
        makeAgent({ id: 'internal-ag', scope: 'internal', clientId: null, name: 'Internal agent', status: 'active', instructions: null }),
      ],
      connections: [
        makeConnection({ id: 'internal-con', scope: 'internal', clientId: null, platform: 'make', verificationStatus: 'failed' }),
      ],
      requirements: [],
    });
    expect(findings).toHaveLength(0);
  });
});

import { getClients } from '@/lib/clients';

// REKREATIVE is the agency's own internal acquisition, never a client —
// scope distinguishes "REKREATIVE's own campaigns" (internal, clientId
// null) from "a client's campaigns" (client, clientId required). Same
// invariant style as lib/leads.ts / lib/content-items.ts / lib/agents-ai.ts.
// Never model REKREATIVE as a fake Client row.
export const META_CAMPAIGN_SCOPE_OPTIONS = [
  { id: 'internal', label: 'REKREATIVE' },
  { id: 'client', label: 'Clientes' },
] as const;
export type MetaCampaignScope = (typeof META_CAMPAIGN_SCOPE_OPTIONS)[number]['id'];

export const CAMPAIGN_STATUS_OPTIONS = [
  { id: 'active', label: 'Activa' },
  { id: 'paused', label: 'Pausada' },
  { id: 'ended', label: 'Finalizada' },
  { id: 'draft', label: 'Borrador' },
] as const;

export const CAMPAIGN_OBJECTIVE_OPTIONS = [
  { id: 'leads', label: 'Leads' },
  { id: 'traffic', label: 'Tráfico' },
  { id: 'awareness', label: 'Notoriedad' },
  { id: 'conversions', label: 'Conversiones' },
  { id: 'engagement', label: 'Interacción' },
] as const;

export type MetaCampaignStatus = (typeof CAMPAIGN_STATUS_OPTIONS)[number]['id'];
export type MetaCampaignObjective = (typeof CAMPAIGN_OBJECTIVE_OPTIONS)[number]['id'];
export type MetaCampaignBudgetType = 'daily' | 'lifetime';

/**
 * 'demo' = seeded placeholder data, 'manual' = entered by hand in this UI,
 * 'meta_api' = reserved for the future live Marketing API pull. Never fake
 * 'meta_api' before that integration exists — same honesty rule as
 * lib/connectors/*'s ConnectorStatus.
 */
export type MetaCampaignDataSource = 'demo' | 'manual' | 'meta_api';

export type MetaCampaign = {
  id: string;
  scope: MetaCampaignScope;
  /** Required when scope === 'client'; always null when scope === 'internal'. */
  clientId: string | null;
  /** Future Meta campaign ID once the live Marketing API is wired. Null until then. */
  externalCampaignId: string | null;

  name: string;
  status: MetaCampaignStatus;
  objective: MetaCampaignObjective;

  budgetType: MetaCampaignBudgetType;
  dailyBudget: number | null;
  lifetimeBudget: number | null;

  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  /** Meta-attributed / advertising-platform leads — NOT CRM leads, appointments, or conversions. */
  leads: number;

  startDate: string;
  endDate: string | null;

  createdAt: string;
  updatedAt: string;

  dataSource: MetaCampaignDataSource;
};

export type CreateMetaCampaignInput = {
  /** Defaults to 'client' when omitted — preserves every existing call
   * site's prior behavior (a required clientId) without a migration. */
  scope?: MetaCampaignScope;
  clientId?: string | null;
  externalCampaignId?: string | null;
  name: string;
  status?: MetaCampaignStatus;
  objective: MetaCampaignObjective;
  budgetType: MetaCampaignBudgetType;
  dailyBudget?: number | null;
  lifetimeBudget?: number | null;
  spend?: number;
  impressions?: number;
  reach?: number;
  clicks?: number;
  leads?: number;
  startDate: string;
  endDate?: string | null;
  dataSource?: MetaCampaignDataSource;
};

const STORAGE_KEY = 'rek_meta_campaigns_v1';

/** Safe read-time migration: every MetaCampaign persisted before `scope`
 * existed (JSON.parse yields `undefined`) was, by definition, a client
 * campaign — this repo had no internal-campaign concept until now.
 * Backfilling here means existing seeded/manual data is never rewritten or
 * lost, only the new field is filled in, the same way every time it's read
 * (same pattern as lib/client-integration-requirements.ts's
 * normalizeRequirement / lib/leads.ts's normalizeLead). */
function normalizeCampaign(raw: MetaCampaign): MetaCampaign {
  if (raw.scope === 'internal' || raw.scope === 'client') return raw;
  return { ...raw, scope: 'client' };
}

function readStorage(): MetaCampaign[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeCampaign) : [];
  } catch (error) {
    console.error(`Failed to parse ${STORAGE_KEY} from localStorage`, error);
    return [];
  }
}

function writeStorage(campaigns: MetaCampaign[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(campaigns));
  } catch (error) {
    console.error(`Failed to write ${STORAGE_KEY} to localStorage`, error);
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function assertScopeInvariant(scope: MetaCampaignScope, clientId: string | null): void {
  if (scope === 'client') {
    if (!clientId) {
      throw new Error('A client-scoped campaign requires a clientId');
    }
    if (!getClients().some((client) => client.id === clientId)) {
      throw new Error('Cannot create campaign for a missing client id');
    }
  }
}

// Seed / demo data — intentionally obvious to be replaced by a live Meta
// Marketing API pull later. Spread across the seeded REKREATIVE clients with
// enough variation to exercise every status, objective, budget type, and the
// zero-denominator edge cases for CTR/CPC/CPL.
function seedDemoCampaigns(): MetaCampaign[] {
  const now = new Date();
  const daysAgo = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const daysFromNow = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const createdAt = daysAgo(45);

  return [
    {
      id: 'campaign-demo-1',
      scope: 'client',
      clientId: 'client-acme',
      externalCampaignId: null,
      name: 'Acme Spring Retargeting',
      status: 'active',
      objective: 'leads',
      budgetType: 'daily',
      dailyBudget: 150,
      lifetimeBudget: null,
      spend: 2380,
      impressions: 184000,
      reach: 96000,
      clicks: 3120,
      leads: 42,
      startDate: daysAgo(20),
      endDate: null,
      createdAt,
      updatedAt: daysAgo(0),
      dataSource: 'demo',
    },
    {
      id: 'campaign-demo-2',
      scope: 'client',
      clientId: 'client-acme',
      externalCampaignId: null,
      name: 'Acme New Client Offer',
      status: 'paused',
      objective: 'conversions',
      budgetType: 'lifetime',
      dailyBudget: null,
      lifetimeBudget: 5000,
      spend: 4120,
      impressions: 96000,
      reach: 51000,
      clicks: 1450,
      leads: 18,
      startDate: daysAgo(45),
      endDate: daysAgo(5),
      createdAt,
      updatedAt: daysAgo(5),
      dataSource: 'demo',
    },
    {
      id: 'campaign-demo-3',
      scope: 'client',
      clientId: 'client-northwind',
      externalCampaignId: null,
      name: 'Northwind Brand Awareness',
      status: 'active',
      objective: 'awareness',
      budgetType: 'daily',
      dailyBudget: 80,
      lifetimeBudget: null,
      spend: 640,
      impressions: 210000,
      reach: 150000,
      clicks: 980,
      leads: 0, // spend with zero leads — validates CPL "—"
      startDate: daysAgo(8),
      endDate: null,
      createdAt,
      updatedAt: daysAgo(0),
      dataSource: 'demo',
    },
    {
      id: 'campaign-demo-4',
      scope: 'client',
      clientId: 'client-northwind',
      externalCampaignId: null,
      name: 'Northwind Retainer Funnel',
      status: 'ended',
      objective: 'leads',
      budgetType: 'lifetime',
      dailyBudget: null,
      lifetimeBudget: 3000,
      spend: 2950,
      impressions: 143000,
      reach: 88000,
      clicks: 2010,
      leads: 31,
      startDate: daysAgo(60),
      endDate: daysAgo(20),
      createdAt,
      updatedAt: daysAgo(20),
      dataSource: 'demo',
    },
    {
      id: 'campaign-demo-5',
      scope: 'client',
      clientId: 'client-lumen',
      externalCampaignId: null,
      name: 'Lumen Launch Offer Reel',
      status: 'draft',
      objective: 'traffic',
      budgetType: 'daily',
      dailyBudget: 40,
      lifetimeBudget: null,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      leads: 0, // zero impressions/clicks/leads — validates CTR/CPC/CPL all "—"
      startDate: daysFromNow(3),
      endDate: null,
      createdAt,
      updatedAt: createdAt,
      dataSource: 'demo',
    },
    {
      id: 'campaign-demo-6',
      scope: 'client',
      clientId: 'client-lumen',
      externalCampaignId: null,
      name: 'Lumen Consulting Video Ad',
      status: 'active',
      objective: 'engagement',
      budgetType: 'daily',
      dailyBudget: 60,
      lifetimeBudget: null,
      spend: 890,
      impressions: 54000,
      reach: 31000,
      clicks: 720,
      leads: 9,
      startDate: daysAgo(12),
      endDate: null,
      createdAt,
      updatedAt: daysAgo(0),
      dataSource: 'demo',
    },
    // REKREATIVE's own internal acquisition — never a client. scope:
    // 'internal', clientId: null. Feeds lead-internal-1/2 in lib/leads.ts.
    {
      id: 'campaign-internal-1',
      scope: 'internal',
      clientId: null,
      externalCampaignId: null,
      name: 'REKREATIVE — Captación Centros de Psicología',
      status: 'active',
      objective: 'leads',
      budgetType: 'daily',
      dailyBudget: 45,
      lifetimeBudget: null,
      spend: 1120,
      impressions: 62000,
      reach: 38000,
      clicks: 940,
      leads: 14,
      startDate: daysAgo(18),
      endDate: null,
      createdAt,
      updatedAt: daysAgo(0),
      dataSource: 'demo',
    },
  ];
}

export function initializeMetaCampaignsStoreIfNeeded(): MetaCampaign[] {
  if (typeof window === 'undefined') {
    return seedDemoCampaigns();
  }

  const existing = readStorage();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDemoCampaigns();
    writeStorage(seeded);
    return seeded;
  }

  return existing;
}

/** No clientId → every campaign (internal + client — see META ADS-scope
 * filtering in app/meta-ads/page.tsx). A clientId → only that client's own
 * campaigns (never internal, never another client's) — the exact contract
 * Client Workspace's ClientMetaAdsPanel relies on for isolation. */
export function getCampaigns(clientId?: string): MetaCampaign[] {
  const campaigns = readStorage();
  const result = !clientId ? campaigns : campaigns.filter((campaign) => campaign.clientId === clientId);
  return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getCampaignById(id: string): MetaCampaign | null {
  return readStorage().find((campaign) => campaign.id === id) ?? null;
}

export function createCampaign(input: CreateMetaCampaignInput): MetaCampaign {
  const scope: MetaCampaignScope = input.scope ?? 'client';
  const clientId = scope === 'client' ? input.clientId ?? null : null;
  assertScopeInvariant(scope, clientId);

  const now = isoNow();
  const created: MetaCampaign = {
    id: `campaign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scope,
    clientId,
    externalCampaignId: input.externalCampaignId ?? null,
    name: input.name.trim(),
    status: input.status ?? 'draft',
    objective: input.objective,
    budgetType: input.budgetType,
    dailyBudget: input.budgetType === 'daily' ? input.dailyBudget ?? null : null,
    lifetimeBudget: input.budgetType === 'lifetime' ? input.lifetimeBudget ?? null : null,
    spend: input.spend ?? 0,
    impressions: input.impressions ?? 0,
    reach: input.reach ?? 0,
    clicks: input.clicks ?? 0,
    leads: input.leads ?? 0,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    createdAt: now,
    updatedAt: now,
    dataSource: input.dataSource ?? 'manual',
  };

  const campaigns = readStorage();
  writeStorage([created, ...campaigns]);
  return created;
}

export function updateCampaign(id: string, patch: Partial<Omit<MetaCampaign, 'id' | 'createdAt'>>): MetaCampaign | null {
  const campaigns = readStorage();
  const index = campaigns.findIndex((campaign) => campaign.id === id);
  if (index === -1) return null;

  const merged: MetaCampaign = {
    ...campaigns[index],
    ...patch,
    updatedAt: isoNow(),
  };

  if (merged.scope === 'internal') {
    merged.clientId = null;
  } else {
    assertScopeInvariant(merged.scope, merged.clientId);
  }

  campaigns[index] = merged;
  writeStorage(campaigns);
  return merged;
}

export function setCampaignStatus(id: string, status: MetaCampaignStatus): MetaCampaign | null {
  return updateCampaign(id, { status });
}

/** See lib/automations.ts's getClientNameForAutomation — same pattern: pass
 *  the canonical PostgreSQL `clients` list when the caller has one loaded. */
export function getClientNameForCampaign(
  clientId: string | null,
  clients: { id: string; name: string }[] = getClients(),
): string {
  if (!clientId) return 'Interno';
  const client = clients.find((item) => item.id === clientId);
  return client?.name ?? 'Cliente desconocido';
}

export function getStatusLabel(status: MetaCampaignStatus): string {
  return CAMPAIGN_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}

export function getObjectiveLabel(objective: MetaCampaignObjective): string {
  return CAMPAIGN_OBJECTIVE_OPTIONS.find((option) => option.id === objective)?.label ?? objective;
}

// ===== DERIVED METRICS (never persisted — always computed from base fields) =====

export function getCampaignCTR(campaign: Pick<MetaCampaign, 'clicks' | 'impressions'>): number | null {
  return campaign.impressions > 0 ? campaign.clicks / campaign.impressions : null;
}

export function getCampaignCPC(campaign: Pick<MetaCampaign, 'spend' | 'clicks'>): number | null {
  return campaign.clicks > 0 ? campaign.spend / campaign.clicks : null;
}

export function getCampaignCPL(campaign: Pick<MetaCampaign, 'spend' | 'leads'>): number | null {
  return campaign.leads > 0 ? campaign.spend / campaign.leads : null;
}

export type CampaignMetricsSummary = {
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
  cpl: number | null;
  ctr: number | null;
};

/** Aggregate KPI totals over a set of campaigns, with derived metrics computed from the totals (not averaged per-campaign). */
export function summarizeCampaigns(campaigns: MetaCampaign[]): CampaignMetricsSummary {
  const totals = campaigns.reduce(
    (acc, campaign) => ({
      spend: acc.spend + campaign.spend,
      leads: acc.leads + campaign.leads,
      impressions: acc.impressions + campaign.impressions,
      clicks: acc.clicks + campaign.clicks,
    }),
    { spend: 0, leads: 0, impressions: 0, clicks: 0 },
  );

  return {
    ...totals,
    cpl: getCampaignCPL(totals),
    ctr: getCampaignCTR(totals),
  };
}

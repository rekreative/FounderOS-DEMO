import { getClients } from '@/lib/clients';

export const CAMPAIGN_STATUS_OPTIONS = [
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'ended', label: 'Ended' },
  { id: 'draft', label: 'Draft' },
] as const;

export const CAMPAIGN_OBJECTIVE_OPTIONS = [
  { id: 'leads', label: 'Leads' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'awareness', label: 'Awareness' },
  { id: 'conversions', label: 'Conversions' },
  { id: 'engagement', label: 'Engagement' },
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
  clientId: string;
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
  clientId: string;
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

function readStorage(): MetaCampaign[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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

export function getCampaigns(clientId?: string): MetaCampaign[] {
  const campaigns = readStorage();
  const result = !clientId ? campaigns : campaigns.filter((campaign) => campaign.clientId === clientId);
  return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getCampaignById(id: string): MetaCampaign | null {
  return readStorage().find((campaign) => campaign.id === id) ?? null;
}

export function createCampaign(input: CreateMetaCampaignInput): MetaCampaign {
  const clients = getClients();
  const clientExists = clients.some((client) => client.id === input.clientId);
  if (!clientExists) {
    throw new Error('Cannot create campaign for a missing client id');
  }

  const now = isoNow();
  const created: MetaCampaign = {
    id: `campaign-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientId: input.clientId,
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

  if (patch.clientId) {
    const clients = getClients();
    const clientExists = clients.some((client) => client.id === patch.clientId);
    if (!clientExists) {
      throw new Error('Cannot move campaign to a missing client id');
    }
  }

  const updated: MetaCampaign = {
    ...campaigns[index],
    ...patch,
    updatedAt: isoNow(),
  };

  campaigns[index] = updated;
  writeStorage(campaigns);
  return updated;
}

export function setCampaignStatus(id: string, status: MetaCampaignStatus): MetaCampaign | null {
  return updateCampaign(id, { status });
}

export function getClientNameForCampaign(clientId: string): string {
  const client = getClients().find((item) => item.id === clientId);
  return client?.name ?? 'Unknown client';
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

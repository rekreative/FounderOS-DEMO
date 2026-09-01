import { apiFetch, nullOn404 } from './http';
import type { ResultsPeriodPreset } from './results';

/**
 * Browser-facing HTTP client for Meta Ads Real V1 (lib/server/meta-repo.ts,
 * GET/POST /api/meta-ads/accounts, PATCH /api/meta-ads/accounts/[id],
 * GET /api/meta-ads/campaigns). Never imports lib/server/*. Distinct from
 * lib/meta-ads.ts, which still owns the browser-localStorage demo
 * MetaCampaign model — this module only ever returns real
 * PostgreSQL-derived numbers, or explicit nulls when nothing is
 * mapped/synced yet.
 */

export type ClientMetaAccount = {
  id: string;
  ownerScope: 'internal' | 'client';
  clientId: string | null;
  metaAdAccountId: string;
  metaPageId: string | null;
  metaFormIds: string[] | null;
  label: string | null;
  active: boolean;
  validFrom: string;
  validTo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateClientMetaAccountInput = {
  ownerScope?: 'internal' | 'client';
  clientId?: string | null;
  metaAdAccountId: string;
  metaPageId?: string | null;
  metaFormIds?: string[] | null;
  label?: string | null;
  active?: boolean;
  validFrom?: string;
  validTo?: string | null;
};

export type UpdateClientMetaAccountInput = Partial<{
  metaPageId: string | null;
  metaFormIds: string[] | null;
  label: string | null;
  active: boolean;
  validTo: string | null;
}>;

export async function listClientMetaAccounts(
  clientId?: string,
  ownerScope?: 'internal' | 'client',
): Promise<ClientMetaAccount[]> {
  const params = new URLSearchParams();
  if (clientId) params.set('clientId', clientId);
  if (ownerScope) params.set('ownerScope', ownerScope);
  const qs = params.toString();
  const { accounts } = await apiFetch<{ accounts: ClientMetaAccount[] }>(`/api/meta-ads/accounts${qs ? `?${qs}` : ''}`);
  return accounts;
}

export async function createClientMetaAccount(input: CreateClientMetaAccountInput): Promise<ClientMetaAccount> {
  const { account } = await apiFetch<{ account: ClientMetaAccount }>('/api/meta-ads/accounts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return account;
}

export async function updateClientMetaAccount(id: string, patch: UpdateClientMetaAccountInput): Promise<ClientMetaAccount | null> {
  return nullOn404(async () => {
    const { account } = await apiFetch<{ account: ClientMetaAccount }>(`/api/meta-ads/accounts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return account;
  });
}

export type MetaSyncRunStatus = 'running' | 'success' | 'partial' | 'error';

export type MetaSyncRun = {
  id: string;
  clientId: string | null;
  metaAdAccountId: string | null;
  metaAccountId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: MetaSyncRunStatus;
  rowsUpserted: number;
  errorMessage: string | null;
  source: string;
};

export type MetaCampaignSummary = {
  metaAdAccountId: string | null;
  metaCampaignId: string;
  campaignName: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  reach: number | null;
  ctr: number | null;
  cpl: number | null;
};

export type MetaSpendSummary = {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  reach: number | null;
  ctr: number | null;
  cpl: number | null;
};

export type MetaAdsCampaignsResponse = {
  period: { preset: ResultsPeriodPreset; start: string | null; end: string | null };
  /** Whether the client (or, unscoped, ANY client) has at least one ACTIVE
   *  client_meta_accounts mapping — the signal that distinguishes "Meta Ads
   *  no configurado" from "configurado, sin datos sincronizados todavía"
   *  even though `summary` is null in both cases. */
  hasAccountMapping: boolean;
  accounts: ClientMetaAccount[];
  summary: MetaSpendSummary | null;
  campaigns: MetaCampaignSummary[];
  lastSync: MetaSyncRun | null;
  /** Populated only for the unscoped (global) call. */
  byClient: { clientId: string; summary: MetaSpendSummary }[];
};

export type GetMetaAdsCampaignsOptions = {
  clientId?: string;
  ownerScope?: 'internal' | 'client';
  preset?: ResultsPeriodPreset;
  start?: string;
  end?: string;
};

/**
 * Total/active campaign counts from a real campaigns array — the single
 * source of truth for "Campañas activas" everywhere it's shown (client
 * Overview card, and any future caller), so it can never regress to a
 * demo-store-shaped or case-sensitive comparison. Meta's real Marketing API
 * returns statuses in UPPERCASE ('ACTIVE', 'PAUSED', 'ARCHIVED', ...) and
 * the real ingestion contract stores that string verbatim — comparison MUST
 * be case-insensitive or every real campaign silently reads as inactive.
 * An empty array (no mapping, or mapped with nothing synced yet) always
 * yields {total: 0, active: 0} — never a fabricated count.
 */
export function countActiveMetaCampaigns(campaigns: Pick<MetaCampaignSummary, 'status'>[]): { total: number; active: number } {
  return {
    total: campaigns.length,
    active: campaigns.filter((campaign) => campaign.status.trim().toUpperCase() === 'ACTIVE').length,
  };
}

export async function getMetaAdsCampaigns(options: GetMetaAdsCampaignsOptions = {}): Promise<MetaAdsCampaignsResponse> {
  const params = new URLSearchParams();
  if (options.clientId) params.set('clientId', options.clientId);
  if (options.ownerScope) params.set('ownerScope', options.ownerScope);
  if (options.preset) params.set('preset', options.preset);
  if (options.start) params.set('start', options.start);
  if (options.end) params.set('end', options.end);
  const qs = params.toString();
  return apiFetch<MetaAdsCampaignsResponse>(`/api/meta-ads/campaigns${qs ? `?${qs}` : ''}`);
}

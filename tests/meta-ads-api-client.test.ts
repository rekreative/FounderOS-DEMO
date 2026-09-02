import { describe, expect, it } from 'vitest';
import { countActiveMetaCampaigns, type MetaCampaignSummary } from '@/lib/api/meta-ads';

// Guards the client Overview "Campañas activas" count (and any other future
// caller) against ever regressing to a case-sensitive or demo-store-shaped
// comparison. Meta's real Marketing API returns statuses in UPPERCASE
// ('ACTIVE', 'PAUSED', 'ARCHIVED', ...) — the real ingestion contract stores
// that exact string verbatim (no enum/normalization), so the count MUST be
// case-insensitive to ever read real data correctly.

function campaign(overrides: Partial<MetaCampaignSummary> = {}): MetaCampaignSummary {
  return {
    metaAdAccountId: null,
    metaCampaignId: 'camp-1',
    campaignName: 'Test Campaign',
    status: 'ACTIVE',
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    reach: null,
    ctr: null,
    cpc: null,
    cpl: null,
    ...overrides,
  };
}

describe('countActiveMetaCampaigns', () => {
  it('counts an UPPERCASE "ACTIVE" status as active (the real Meta API convention)', () => {
    expect(countActiveMetaCampaigns([campaign({ status: 'ACTIVE' })])).toEqual({ total: 1, active: 1 });
  });

  it('also counts a lowercase "active" status as active (case-insensitive, never brittle)', () => {
    expect(countActiveMetaCampaigns([campaign({ status: 'active' })])).toEqual({ total: 1, active: 1 });
  });

  it('does not count PAUSED/ARCHIVED/other non-active statuses', () => {
    expect(
      countActiveMetaCampaigns([campaign({ status: 'PAUSED' }), campaign({ status: 'ARCHIVED' }), campaign({ status: 'DRAFT' })]),
    ).toEqual({ total: 3, active: 0 });
  });

  it('mixed statuses: total counts every campaign, active counts only the real ACTIVE ones', () => {
    expect(
      countActiveMetaCampaigns([
        campaign({ metaCampaignId: 'a', status: 'ACTIVE' }),
        campaign({ metaCampaignId: 'b', status: 'PAUSED' }),
        campaign({ metaCampaignId: 'c', status: 'ACTIVE' }),
      ]),
    ).toEqual({ total: 3, active: 2 });
  });

  it('an empty campaigns array (no mapping, or mapped with nothing synced yet) never fabricates a count', () => {
    expect(countActiveMetaCampaigns([])).toEqual({ total: 0, active: 0 });
  });
});

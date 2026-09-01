import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CreateClientMetaAccountBodySchema,
  ListClientMetaAccountsQuerySchema,
  MetaAdsCampaignsQuerySchema,
} from '@/lib/server/schemas';
import { MIGRATIONS_DIR } from '@/lib/server/migrate';

describe('Meta account owner contracts', () => {
  it('keeps legacy client mapping requests compatible', () => {
    expect(
      CreateClientMetaAccountBodySchema.parse({
        clientId: 'client-acme',
        metaAdAccountId: '3704368926499756',
      }),
    ).toMatchObject({ ownerScope: 'client', clientId: 'client-acme' });
  });

  it('accepts an internal owner without a client', () => {
    expect(
      CreateClientMetaAccountBodySchema.parse({
        ownerScope: 'internal',
        clientId: null,
        metaAdAccountId: '3704368926499756',
      }),
    ).toMatchObject({ ownerScope: 'internal', clientId: null });
  });

  it('rejects invalid owner/client combinations', () => {
    expect(
      CreateClientMetaAccountBodySchema.safeParse({
        ownerScope: 'internal',
        clientId: 'client-acme',
        metaAdAccountId: '3704368926499756',
      }).success,
    ).toBe(false);
    expect(
      CreateClientMetaAccountBodySchema.safeParse({
        ownerScope: 'client',
        clientId: null,
        metaAdAccountId: '3704368926499756',
      }).success,
    ).toBe(false);
  });

  it('allows internal-only administrative reads without weakening client reads', () => {
    expect(ListClientMetaAccountsQuerySchema.parse({ ownerScope: 'internal' })).toEqual({ ownerScope: 'internal' });
    expect(MetaAdsCampaignsQuerySchema.parse({ ownerScope: 'internal' })).toMatchObject({ ownerScope: 'internal' });
    expect(MetaAdsCampaignsQuerySchema.safeParse({ ownerScope: 'internal', clientId: 'client-acme' }).success).toBe(false);
  });
});

describe('0010 Meta internal ownership migration contract', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0010_meta_internal_owner.sql'), 'utf8');

  it('adds owner scope and enforces the internal/client invariant', () => {
    expect(sql).toMatch(/owner_scope TEXT NOT NULL DEFAULT 'client'/);
    expect(sql).toMatch(/owner_scope = 'internal' AND client_id IS NULL/);
    expect(sql).toMatch(/owner_scope = 'client' AND client_id IS NOT NULL/);
  });

  it('tracks effective ownership without overlapping ranges', () => {
    expect(sql).toMatch(/valid_from DATE/);
    expect(sql).toMatch(/valid_to DATE/);
    expect(sql).toMatch(/EXCLUDE USING gist/);
  });

  it('uses the canonical Meta identity for daily metric uniqueness', () => {
    expect(sql).toMatch(/meta_ad_account_id TEXT/);
    expect(sql).toMatch(/meta_account_id TEXT/);
    expect(sql).toMatch(/meta_ad_account_id, meta_campaign_id, date/);
  });

  it('adds the running sync state and account-level traceability', () => {
    expect(sql).toMatch(/'running'/);
    expect(sql).toMatch(/meta_sync_runs[\s\S]*meta_ad_account_id/);
    expect(sql).toMatch(/meta_sync_runs[\s\S]*meta_account_id/);
  });

  it('explicitly enables RLS on every Meta table', () => {
    for (const table of ['client_meta_accounts', 'meta_sync_runs', 'meta_campaign_daily_metrics']) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IngestLeadBodySchema } from '@/lib/server/schemas';

const base = {
  deliveryId: 'delivery-1',
  ingestionSource: 'meta_lead_ads',
  externalLeadId: 'meta-lead-1',
  leadSource: 'Meta Ads',
  name: 'Lead de prueba',
  metaFormId: '1650536646802705',
  metaPageId: '193393520519710',
};

describe('Meta lead tenant-routing contract', () => {
  it('accepts provider identities without caller-controlled ownership', () => {
    expect(IngestLeadBodySchema.safeParse(base).success).toBe(true);
  });

  it('keeps the current Make payload compatible during migration', () => {
    expect(IngestLeadBodySchema.safeParse({ ...base, scope: 'internal' }).success).toBe(true);
  });

  it('still rejects lifecycle stage injection', () => {
    expect(IngestLeadBodySchema.safeParse({ ...base, stage: 'converted' }).success).toBe(false);
  });

  it('requires an identified Meta page to resolve through a registered owner instead of caller scope', () => {
    const source = readFileSync(join(process.cwd(), 'lib/server/leads-repo.ts'), 'utf8');
    expect(source).toContain('SELECT DISTINCT owner_scope, client_id');
    expect(source).toContain('AND meta_page_id = $1');
    expect(source).toContain('if (input.metaPageId && !resolvedFromMeta)');
    expect(source).toContain("Meta page is not mapped to an active owner");
  });
});

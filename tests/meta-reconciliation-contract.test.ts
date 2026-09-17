import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Meta lead reconciliation V1 contract', () => {
  it('is internal-only and never presents Meta totals as CRM totals', () => {
    const route = read('app/api/results/reconciliation/route.ts');
    const repo = read('lib/server/meta-reconciliation.ts');

    expect(route).toContain('requireInternalUserOrResponse');
    expect(repo).toContain("account.owner_scope = 'internal'");
    expect(repo).toContain("l.scope = 'internal'");
    expect(repo).toContain("l.ingestion_source = 'meta_lead_ads'");
    expect(repo).toContain('difference: metaLeads - rekreosLeads');
  });

  it('keeps unattributed CRM leads and WhatsApp failures visible as diagnostics', () => {
    const repo = read('lib/server/meta-reconciliation.ts');
    const panel = read('components/MetaLeadReconciliationPanel.tsx');

    expect(repo).toContain('l.meta_campaign_id IS NULL');
    expect(repo).toContain("'whatsapp_failed'");
    expect(panel).toContain('sin campaña atribuida');
    expect(panel).toContain('WhatsApp fallido');
  });
});

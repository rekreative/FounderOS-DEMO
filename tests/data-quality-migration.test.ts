import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = fs.readFileSync(path.join(process.cwd(), 'lib/server/migrations/0015_data_quality_v1.sql'), 'utf8');

describe('0015_data_quality_v1.sql', () => {
  it('adds Meta page attribution without rewriting existing leads', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS meta_page_id TEXT/);
    expect(sql).toMatch(/idx_leads_meta_page_form/);
  });

  it('allows the canonical WhatsApp failure event', () => {
    expect(sql).toContain("'whatsapp_failed'");
  });
});

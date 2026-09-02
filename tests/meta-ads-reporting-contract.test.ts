import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MetaAdsCampaignsQuerySchema } from '@/lib/server/schemas';

const page = readFileSync(join(process.cwd(), 'app/(internal)/meta-ads/page.tsx'), 'utf8');
const apiClient = readFileSync(join(process.cwd(), 'lib/api/meta-ads.ts'), 'utf8');

describe('Meta Ads Reporting V1 contract', () => {
  it('accepts a canonical account filter and a complete custom period', () => {
    expect(MetaAdsCampaignsQuerySchema.parse({
      ownerScope: 'internal',
      metaAdAccountId: '3704368926499756',
      preset: 'custom',
      start: '2026-03-01',
      end: '2026-03-31',
    })).toMatchObject({ metaAdAccountId: '3704368926499756', preset: 'custom' });
  });

  it('rejects incomplete or reversed custom periods', () => {
    expect(MetaAdsCampaignsQuerySchema.safeParse({ preset: 'custom', start: '2026-03-01' }).success).toBe(false);
    expect(MetaAdsCampaignsQuerySchema.safeParse({ preset: 'custom', start: '2026-04-01', end: '2026-03-01' }).success).toBe(false);
    expect(MetaAdsCampaignsQuerySchema.safeParse({ preset: 'all', start: '2026-03-01', end: '2026-03-31' }).success).toBe(false);
  });

  it('serializes the account filter without adding clientId or scope to ingestion', () => {
    expect(apiClient).toContain("params.set('metaAdAccountId', options.metaAdAccountId)");
  });

  it('renders every required KPI and documents additive daily reach', () => {
    for (const label of ['Gasto', 'Impresiones', 'Alcance diario*', 'Clics', 'Leads Meta', 'CTR', 'CPC', 'CPL']) {
      expect(page).toContain(`label: '${label}'`);
    }
    expect(page).toContain('puede repetir personas entre días');
    expect(page).not.toContain('Math.round(value)');
  });

  it('contains account, custom-period, retry, sync, loading and honest empty states', () => {
    expect(page).toContain('Cuenta Meta');
    expect(page).toContain('Todas las cuentas');
    expect(page).toContain('type="date"');
    expect(page).toContain('Reintentar');
    expect(page).toContain('Sincronización por cuenta');
    expect(page).toContain('Cargando…');
    expect(page).toContain('No hay datos en el periodo seleccionado.');
    expect(page).toContain('todavía no tiene métricas sincronizadas.');
  });
});

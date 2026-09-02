import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SaveInternalBusinessWorkspaceBodySchema } from '@/lib/server/schemas';

const validWorkspace = {
  profile: {
    displayName: 'REKREATIVE',
    description: 'Operación interna de prueba.',
    ownerName: 'Kilian',
    timezone: 'Europe/Madrid',
    currency: 'EUR',
    monthlyRevenueTarget: 10_000,
    monthlyNewClientsMin: 6,
    monthlyNewClientsTarget: 7,
    monthlyNewClientsMax: 8,
    monthlyLeadsMin: 50,
    monthlyLeadsTarget: 60,
    monthlyLeadsMax: 70,
    monthlyAppointmentsTarget: 20,
    acquisitionChannels: ['Meta Ads', 'Redes sociales', 'Llamadas en frío'],
    tools: ['Make', 'Meta', 'Google Sheets'],
    commercialPolicy: 'Los servicios mensuales se facturan por adelantado.',
  },
  services: [
    {
      name: 'Campaña de publicidad en Meta',
      description: 'Configuración y lanzamiento.',
      price: 600,
      billingType: 'one_off' as const,
      allowTwoPayments: true,
      secondPaymentTrigger: '300 al inicio y 300 al lanzar la campaña.',
      active: true,
      sortOrder: 0,
    },
  ],
};

describe('REKREATIVE internal workspace contract', () => {
  it('accepts a complete internal business workspace', () => {
    expect(SaveInternalBusinessWorkspaceBodySchema.safeParse(validWorkspace).success).toBe(true);
  });

  it('rejects unordered monthly target ranges', () => {
    const result = SaveInternalBusinessWorkspaceBodySchema.safeParse({
      ...validWorkspace,
      profile: { ...validWorkspace.profile, monthlyLeadsMin: 70, monthlyLeadsTarget: 60 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects split payments for monthly services', () => {
    const result = SaveInternalBusinessWorkspaceBodySchema.safeParse({
      ...validWorkspace,
      services: [{ ...validWorkspace.services[0], billingType: 'monthly' }],
    });
    expect(result.success).toBe(false);
  });

  it('requires a second-payment trigger when split payments are enabled', () => {
    const result = SaveInternalBusinessWorkspaceBodySchema.safeParse({
      ...validWorkspace,
      services: [{ ...validWorkspace.services[0], secondPaymentTrigger: null }],
    });
    expect(result.success).toBe(false);
  });

  it('migration creates internal-only tables, invariants and zero RLS policies', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'lib', 'server', 'migrations', '0011_internal_business_workspace.sql'),
      'utf8',
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS internal_business_profile/);
    expect(sql).toMatch(/workspace_key TEXT PRIMARY KEY CHECK \(workspace_key = 'rekreative'\)/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS internal_business_services/);
    expect(sql).toMatch(/internal_business_services_payment_check/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/g);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it('API GET and PUT are both protected by the internal-user guard', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app', 'api', 'business', 'route.ts'), 'utf8');
    expect(source.match(/requireInternalUserOrResponse\(\)/g)).toHaveLength(2);
    expect(source).toMatch(/SaveInternalBusinessWorkspaceBodySchema\.safeParse/);
  });

  it('page is present and exposes profile, targets, services and commercial terms', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app', '(internal)', 'business', 'page.tsx'), 'utf8');
    expect(source).toContain('Perfil del negocio');
    expect(source).toContain('Objetivos mensuales');
    expect(source).toContain('Servicios y precios');
    expect(source).toContain('Condiciones comerciales');
  });
});

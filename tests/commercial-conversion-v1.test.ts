import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommercialEventBodySchema, ManualCommercialEventBodySchema } from '@/lib/server/schemas';

describe('Commercial Conversion V1 contract', () => {
  const enrichedConversion = {
    type: 'converted' as const,
    serviceId: 'service-meta-campaign',
    paymentPlan: 'two_payments' as const,
    conversionValue: 600,
    initialPayment: 300,
  };

  it('accepts service, agreed value and payment information together', () => {
    expect(ManualCommercialEventBodySchema.safeParse(enrichedConversion).success).toBe(true);
    expect(CommercialEventBodySchema.safeParse({
      ...enrichedConversion,
      leadId: 'lead-1',
      externalEventId: 'conversion-1',
    }).success).toBe(true);
  });

  it('rejects partial commercial terms', () => {
    expect(ManualCommercialEventBodySchema.safeParse({ type: 'converted', serviceId: 'service-meta-campaign' }).success).toBe(false);
  });

  it('rejects an initial payment above the agreed value', () => {
    expect(ManualCommercialEventBodySchema.safeParse({ ...enrichedConversion, initialPayment: 700 }).success).toBe(false);
  });

  it('migration stores an immutable service and price snapshot on the lead', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'lib', 'server', 'migrations', '0013_commercial_conversion_v1.sql'),
      'utf8',
    );
    expect(sql).toMatch(/conversion_service_id/);
    expect(sql).toMatch(/conversion_service_name/);
    expect(sql).toMatch(/conversion_service_standard_price/);
    expect(sql).toMatch(/conversion_payment_plan/);
    expect(sql).toMatch(/conversion_initial_payment/);
    expect(sql).toMatch(/conversion_recorded_at/);
  });

  it('Leads replaces the optional value shortcut with the conversion workflow', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app', '(internal)', 'leads', 'page.tsx'), 'utf8');
    expect(source).toContain('Registrar conversión');
    expect(source).toContain('Servicio contratado');
    expect(source).toContain('Importe pendiente');
    expect(source).not.toContain('Valor (€, opcional)');
  });
});

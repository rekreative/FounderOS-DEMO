import { describe, expect, it } from 'vitest';
import { buildOpsIncidents, type OpsIncidentInput } from '@/lib/ops-incidents';

const baseInput = (overrides: Partial<OpsIncidentInput> = {}): OpsIncidentInput => ({
  metaDifference: 0,
  metaSyncError: null,
  whatsappFailed: 0,
  whatsappUnconfirmed: 0,
  missingMappings: 0,
  ...overrides,
});

describe('buildOpsIncidents', () => {
  it('returns a clean empty list when no discrepancy or failure is observed', () => {
    expect(buildOpsIncidents(baseInput())).toEqual([]);
  });

  it('surfaces Meta discrepancies, WhatsApp failures/unconfirmed sends and missing mappings with stable categories', () => {
    const incidents = buildOpsIncidents(
      baseInput({
        metaDifference: 4,
        metaSyncError: 'rate limit',
        whatsappFailed: 2,
        whatsappUnconfirmed: 14,
        missingMappings: 1,
      }),
    );

    expect(incidents.map((incident) => incident.category)).toEqual(['meta', 'meta', 'whatsapp', 'whatsapp', 'mapping']);
    expect(incidents.find((incident) => incident.id === 'meta-sync-error')?.severity).toBe('critical');
    expect(incidents.find((incident) => incident.id === 'meta-lead-discrepancy')?.detail).toContain('4');
    expect(incidents.find((incident) => incident.id === 'whatsapp-failed')?.severity).toBe('critical');
    expect(incidents.find((incident) => incident.id === 'whatsapp-unconfirmed')?.detail).toContain('14');
    expect(incidents.find((incident) => incident.id === 'missing-mappings')?.severity).toBe('warning');
  });

  it('normalizes a negative Meta difference without hiding it', () => {
    const [incident] = buildOpsIncidents(baseInput({ metaDifference: -3 }));
    expect(incident.id).toBe('meta-lead-discrepancy');
    expect(incident.detail).toContain('-3');
  });
});

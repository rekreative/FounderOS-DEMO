import { describe, expect, it } from 'vitest';
import { countObservedAutomations, type OpsClientAutomationStatus } from '@/lib/ops-status';

// Pure unit tests (no DB) for the Client Overview truth-alignment helper —
// [G] the Overview's Automations/AI Agents summaries must be derived only
// from OpsClientSnapshot data, never from lib/automations.ts/lib/agents-ai.ts's
// localStorage run telemetry. countObservedAutomations's signature only
// accepts OpsClientAutomationStatus[] — legacy Automation[] data has no way
// to reach it, by construction.

function automation(status: OpsClientAutomationStatus['status']): OpsClientAutomationStatus {
  return {
    id: 'lead_intake',
    name: 'Captación de leads (Meta → Make)',
    purpose: 'test',
    execution: 'Make',
    status,
    detail: 'test',
    lastActivityAt: status === 'activity_observed' ? '2026-08-01T00:00:00.000Z' : null,
  };
}

describe('lib/ops-status — countObservedAutomations', () => {
  it('counts only activity_observed workflows, out of all 7 possible statuses', () => {
    const automations: OpsClientAutomationStatus[] = [
      automation('activity_observed'),
      automation('activity_observed'),
      automation('configured'),
      automation('not_configured'),
      automation('needs_attention'),
      automation('unknown'),
      automation('demo'),
      automation('operational'),
    ];
    expect(countObservedAutomations(automations)).toBe(2);
  });

  it('returns 0 for an empty list, never throwing', () => {
    expect(countObservedAutomations([])).toBe(0);
  });

  it('returns 0 when no workflow has observed activity', () => {
    expect(countObservedAutomations([automation('configured'), automation('not_configured')])).toBe(0);
  });
});

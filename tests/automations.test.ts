import { describe, it, expect } from 'vitest';
import {
  AUTOMATION_PLATFORM_OPTIONS,
  createAutomation,
  getAutomationHealth,
  getAutomationRunStats,
  getHealthLabel,
  getPlatformLabel,
  getRunStatusLabel,
  getStatusLabel,
  getTypeLabel,
  initializeAutomationsStoreIfNeeded,
  type AutomationRun,
} from '@/lib/automations';

// This suite runs under vitest's `node` environment (see vitest.config.ts),
// which has no `window`/`localStorage` — exactly like lib/clients.ts,
// lib/leads.ts, and lib/meta-ads.ts, none of which have dedicated unit
// tests either. What IS testable in node are the pure derivation helpers
// (health, run stats, labels) and the SSR-safe fallbacks; CRUD against
// localStorage needs a browser and is exercised by manual verification.

describe('getAutomationHealth', () => {
  it('is never_run when no run has happened yet', () => {
    expect(getAutomationHealth({ lastRunAt: null, lastRunStatus: null })).toBe('never_run');
  });

  it('is needs_attention when the last run failed', () => {
    expect(getAutomationHealth({ lastRunAt: '2026-01-01T00:00:00.000Z', lastRunStatus: 'failed' })).toBe(
      'needs_attention',
    );
  });

  it('is healthy when the last run succeeded', () => {
    expect(getAutomationHealth({ lastRunAt: '2026-01-01T00:00:00.000Z', lastRunStatus: 'success' })).toBe('healthy');
  });

  it('is healthy (not needs_attention) while the last run is still running', () => {
    expect(getAutomationHealth({ lastRunAt: '2026-01-01T00:00:00.000Z', lastRunStatus: 'running' })).toBe('healthy');
  });
});

describe('getAutomationRunStats', () => {
  const run = (status: AutomationRun['status']): AutomationRun => ({
    id: `run-${status}-${Math.random()}`,
    automationId: 'a1',
    status,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:00.000Z',
    summary: 'x',
    error: null,
    source: 'demo',
  });

  it('returns a null successRate — not zero — when there are no completed runs', () => {
    expect(getAutomationRunStats([])).toEqual({ totalRuns: 0, successfulRuns: 0, failedRuns: 0, successRate: null });
  });

  it('excludes in-flight running runs from the completed denominator', () => {
    const stats = getAutomationRunStats([run('running')]);
    expect(stats.totalRuns).toBe(1);
    expect(stats.successRate).toBeNull();
  });

  it('computes successRate over success + failed only', () => {
    const stats = getAutomationRunStats([run('success'), run('success'), run('failed'), run('running')]);
    expect(stats).toEqual({ totalRuns: 4, successfulRuns: 2, failedRuns: 1, successRate: 2 / 3 });
  });
});

describe('label helpers', () => {
  it('resolve known ids to human labels', () => {
    expect(getStatusLabel('active')).toBe('Active');
    expect(getHealthLabel('needs_attention')).toBe('Needs Attention');
    expect(getPlatformLabel('google_sheets')).toBe('Google Sheets');
    expect(getTypeLabel('lead_response')).toBe('Lead Response');
    expect(getRunStatusLabel('failed')).toBe('Failed');
  });

  it('falls back to the raw id for an unrecognized value rather than throwing', () => {
    expect(getPlatformLabel('carrier_pigeon' as never)).toBe('carrier_pigeon');
  });
});

describe('platform enum', () => {
  it('contains exactly the controlled REKREATIVE platform set', () => {
    expect(AUTOMATION_PLATFORM_OPTIONS.map((o) => o.id)).toEqual([
      'make',
      'manychat',
      'whatsapp',
      'meta',
      'openai',
      'google_sheets',
      'calendar',
      'internal',
    ]);
  });
});

describe('server-side (no window) behavior', () => {
  it('initializeAutomationsStoreIfNeeded falls back to in-memory seed data', () => {
    const seeded = initializeAutomationsStoreIfNeeded();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((a) => a.dataSource === 'demo')).toBe(true);
  });

  it('createAutomation rejects a client id that cannot be found (client list is empty without window)', () => {
    expect(() =>
      createAutomation({
        clientId: 'client-does-not-exist',
        name: 'Test automation',
        type: 'other',
        platforms: ['internal'],
        trigger: { platform: 'internal', event: 'x', description: 'x' },
      }),
    ).toThrow('Cannot create automation for a missing client id');
  });
});

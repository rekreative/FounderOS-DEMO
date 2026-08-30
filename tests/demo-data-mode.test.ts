import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ORIGINAL_SERVER_FLAG = process.env.FOUNDER_OS_SEED_DEMO_DATA;
const ORIGINAL_BROWSER_FLAG = process.env.NEXT_PUBLIC_REKREOS_DEMO_DATA;
const ORIGINAL_DB = process.env.FOUNDER_OS_DB;
let tmp: string | undefined;

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
}

function installBrowserStorage(storage: MemoryStorage): void {
  (globalThis as unknown as { window: unknown }).window = { localStorage: storage };
  (globalThis as unknown as { localStorage: unknown }).localStorage = storage;
}

afterEach(() => {
  if (ORIGINAL_SERVER_FLAG === undefined) delete process.env.FOUNDER_OS_SEED_DEMO_DATA;
  else process.env.FOUNDER_OS_SEED_DEMO_DATA = ORIGINAL_SERVER_FLAG;
  if (ORIGINAL_BROWSER_FLAG === undefined) delete process.env.NEXT_PUBLIC_REKREOS_DEMO_DATA;
  else process.env.NEXT_PUBLIC_REKREOS_DEMO_DATA = ORIGINAL_BROWSER_FLAG;
  if (ORIGINAL_DB === undefined) delete process.env.FOUNDER_OS_DB;
  else process.env.FOUNDER_OS_DB = ORIGINAL_DB;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
  vi.resetModules();
});

describe('demo data mode', () => {
  it('keeps demo data enabled by default for local development', async () => {
    const { isBrowserDemoDataEnabled, isServerDemoDataEnabled } = await import('@/lib/demo-data');
    delete process.env.FOUNDER_OS_SEED_DEMO_DATA;
    delete process.env.NEXT_PUBLIC_REKREOS_DEMO_DATA;
    expect(isServerDemoDataEnabled()).toBe(true);
    expect(isBrowserDemoDataEnabled()).toBe(true);
  });

  it('disables server and browser demo data only when each flag is exactly false', async () => {
    const { isBrowserDemoDataEnabled, isServerDemoDataEnabled } = await import('@/lib/demo-data');
    process.env.FOUNDER_OS_SEED_DEMO_DATA = 'false';
    process.env.NEXT_PUBLIC_REKREOS_DEMO_DATA = 'false';
    expect(isServerDemoDataEnabled()).toBe(false);
    expect(isBrowserDemoDataEnabled()).toBe(false);
  });

  it('removes demo records while preserving manual records', async () => {
    const { withoutDemoRecords } = await import('@/lib/demo-data');
    expect(withoutDemoRecords([
      { id: 'demo', dataSource: 'demo' },
      { id: 'manual', dataSource: 'manual' },
      { id: 'legacy' },
    ])).toEqual([
      { id: 'manual', dataSource: 'manual' },
      { id: 'legacy' },
    ]);
  });

  it('opens an empty SQLite store without reseeding when production demo data is disabled', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-data-mode-'));
    process.env.FOUNDER_OS_DB = path.join(tmp, 'founder-os.db');
    process.env.FOUNDER_OS_SEED_DEMO_DATA = 'false';

    vi.resetModules();
    const { getDb } = await import('@/lib/data');
    const db = getDb();
    try {
      expect(db.departments.all()).toEqual([]);
      expect(db.agents.all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('purges legacy browser demo records and preserves manual records', async () => {
    process.env.NEXT_PUBLIC_REKREOS_DEMO_DATA = 'false';
    const storage = new MemoryStorage();
    installBrowserStorage(storage);

    storage.setItem('rek_ai_agents_v1', JSON.stringify([
      { id: 'agent-demo', dataSource: 'demo' },
      { id: 'agent-manual', dataSource: 'manual' },
    ]));
    storage.setItem('rek_content_items_v1', JSON.stringify([
      { id: 'content-demo', dataSource: 'demo' },
      { id: 'content-manual', dataSource: 'manual' },
    ]));
    storage.setItem('rek_meta_campaigns_v1', JSON.stringify([
      { id: 'campaign-demo', scope: 'internal', dataSource: 'demo' },
      { id: 'campaign-manual', scope: 'internal', dataSource: 'manual' },
    ]));
    storage.setItem('rek_automations_v1', JSON.stringify([
      { id: 'automation-demo', scope: 'internal', dataSource: 'demo' },
      { id: 'automation-manual', scope: 'internal', dataSource: 'manual' },
    ]));
    storage.setItem('rek_automation_runs_v1', JSON.stringify([
      { id: 'run-demo', automationId: 'automation-demo' },
      { id: 'run-manual', automationId: 'automation-manual' },
    ]));

    const { initializeAiAgentsStoreIfNeeded } = await import('@/lib/agents-ai');
    const { initializeContentStoreIfNeeded } = await import('@/lib/content-items');
    const { initializeMetaCampaignsStoreIfNeeded } = await import('@/lib/meta-ads');
    const { initializeAutomationsStoreIfNeeded } = await import('@/lib/automations');

    expect(initializeAiAgentsStoreIfNeeded().map((item) => item.id)).toEqual(['agent-manual']);
    expect(initializeContentStoreIfNeeded().map((item) => item.id)).toEqual(['content-manual']);
    expect(initializeMetaCampaignsStoreIfNeeded().map((item) => item.id)).toEqual(['campaign-manual']);
    expect(initializeAutomationsStoreIfNeeded().map((item) => item.id)).toEqual(['automation-manual']);
    expect(JSON.parse(storage.getItem('rek_automation_runs_v1') ?? '[]')).toEqual([
      { id: 'run-manual', automationId: 'automation-manual' },
    ]);
  });

  it('removes the three obsolete browser demo clients but keeps manual clients', async () => {
    process.env.NEXT_PUBLIC_REKREOS_DEMO_DATA = 'false';
    const storage = new MemoryStorage();
    installBrowserStorage(storage);
    storage.setItem('rek_clients_v1_seeded_v1', JSON.stringify([
      { id: 'client-acme', name: 'Acme Co' },
      { id: 'client-real', name: 'Real Client' },
    ]));

    const { initializeStoreIfNeeded } = await import('@/lib/clients');
    expect(initializeStoreIfNeeded().map((client) => client.id)).toEqual(['client-real']);
    expect(JSON.parse(storage.getItem('rek_clients_v1_seeded_v1') ?? '[]')).toEqual([
      { id: 'client-real', name: 'Real Client' },
    ]);
  });
});

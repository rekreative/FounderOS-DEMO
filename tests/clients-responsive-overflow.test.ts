import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('Clients responsive overflow contract', () => {
  const detail = read('app/(internal)/clients/[clientId]/page.tsx');
  const clientsPage = read('app/(internal)/clients/page.tsx');
  const list = read('components/ClientsList.tsx');
  const form = read('components/ClientsForm.tsx');
  const pageHeader = read('components/PageHeader.tsx');
  const leadsPanel = read('components/ClientLeadsPanel.tsx');
  const metaAdsPanel = read('components/ClientMetaAdsPanel.tsx');
  const integrationsPanel = read('components/ClientIntegrationsPanel.tsx');

  test('replaces the ten client tabs with a compact mobile selector', () => {
    expect(detail).toContain('aria-label="Sección del cliente"');
    expect(detail).toContain('sm:hidden');
    expect(detail).toContain('hidden sm:block');
    expect(detail).toContain('flex-wrap');
  });

  test('keeps client search and status categories inside the available width', () => {
    expect(clientsPage).toContain('w-full min-w-0');
    expect(clientsPage).toContain('grid-cols-2');
    expect(clientsPage).toContain('sm:flex');
  });

  test('stacks identity, actions and metadata safely on narrow screens', () => {
    expect(detail).toContain('flex-col');
    expect(detail).toContain('sm:flex-row');
    expect(detail).toContain('grid-cols-1');
    expect(detail).toContain('sm:grid-cols-2');
    expect(detail).toContain('xl:grid-cols-4');
    expect(detail).toContain('break-words');
  });

  test('renders client cards on mobile and keeps the table for wider screens', () => {
    expect(list).toContain('md:hidden');
    expect(list).toContain('hidden md:block');
    expect(list).toContain('break-words');
  });

  test('keeps the client form inside the viewport', () => {
    expect(form).toContain('overflow-y-auto');
    expect(form).toContain('grid-cols-1');
    expect(form).toContain('sm:grid-cols-2');
    expect(form).toContain('min-w-0');
  });

  test('lets shared page headers stack instead of overflowing', () => {
    expect(pageHeader).toContain('flex-col');
    expect(pageHeader).toContain('sm:flex-row');
    expect(pageHeader).toContain('break-words');
  });

  test('keeps dense client panel tables scrollable inside their cards', () => {
    for (const panel of [leadsPanel, metaAdsPanel, integrationsPanel]) {
      expect(panel).toContain('overflow-x-auto');
      expect(panel).toContain('break-words');
    }
  });
});

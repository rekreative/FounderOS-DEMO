import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Home Executive responsive contract', () => {
  const home = read('app/(internal)/page.tsx');
  const layout = read('app/(internal)/layout.tsx');
  const mobileNav = read('components/MobileNav.tsx');

  test('uses only real operational sources on the executive home', () => {
    expect(home).not.toContain("from '@/lib/automations'");
    expect(home).not.toContain("from '@/lib/content-items'");
    expect(home).not.toContain('localStorage');
    expect(home).not.toContain('demo');
  });

  test('puts priorities, KPIs, funnel, clients and the operational agenda in one hierarchy', () => {
    expect(home).toContain('Prioridades de hoy');
    expect(home).toContain('Indicadores principales');
    expect(home).toContain('Funnel comercial');
    expect(home).toContain('Cartera de clientes');
    expect(home).toContain('Pulso operativo');
    expect(home).toContain('Agenda operativa');
    expect(home).toContain('Necesita atención');
  });

  test('groups the dashboard into dense responsive panels', () => {
    expect(home).toContain('xl:grid-cols-12');
    expect(home).toContain('xl:col-span-8');
    expect(home).toContain('xl:col-span-4');
    expect(home).toContain('Datos en tiempo real');
    expect(home).not.toContain('<Kbd>');
  });

  test('turns empty states into useful next actions', () => {
    expect(home).toContain('Añadir primer cliente');
    expect(home).toContain('Conectar Meta Ads');
    expect(home).toContain('Los nuevos leads aparecerán aquí');
  });

  test('provides mobile cards and a separate wide client table', () => {
    expect(home).toContain('lg:hidden');
    expect(home).toContain('hidden lg:block');
    expect(home).toContain('overflow-x-auto');
  });

  test('removes the desktop sidebar offset on small screens', () => {
    expect(layout).toContain('lg:ml-[var(--sidebar-w,232px)]');
    expect(layout).toContain('pb-20');
    expect(layout).toContain('lg:pb-16');
    expect(layout).toContain('<MobileNav />');
  });

  test('offers a compact five-destination bottom navigation', () => {
    expect(mobileNav).toContain('fixed inset-x-0 bottom-0');
    expect(mobileNav).toContain("href: '/'");
    expect(mobileNav).toContain("href: '/clients'");
    expect(mobileNav).toContain("href: '/leads'");
    expect(mobileNav).toContain("href: '/results'");
    expect(mobileNav).toContain("href: '/connections'");
  });

});

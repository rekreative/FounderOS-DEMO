import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(root, ...segments), 'utf8');
}

describe('Client Portal Leads V2', () => {
  it.each([
    ['stage'],
    ['events'],
    ['commercial-events'],
  ])('authorizes POST /api/leads/[id]/%s from the stored lead tenant', (routeName) => {
    const source = read('app', 'api', 'leads', '[id]', routeName, 'route.ts');

    expect(source).toMatch(/requireUserOrResponse/);
    expect(source).toMatch(/getLeadById\(params\.id\)/);
    expect(source).toMatch(/canAccessClientScopedObject\(auth\.user, lead\.clientId\)/);
    expect(source).not.toMatch(/requireInternalUserOrResponse/);
  });

  it('exposes a tenant-scoped lead manager from the client workspace', () => {
    const page = read('app', '(client)', 'portal', '[clientId]', 'page.tsx');
    const manager = read('components', 'ClientPortalLeadManager.tsx');

    expect(page).toMatch(/ClientPortalLeadManager/);
    expect(page).toMatch(/clientId=\{client\.id\}/);
    expect(manager).toMatch(/getLeads\(\{ clientId \}\)/);
    expect(manager).toMatch(/getLeadEvents/);
    expect(manager).toMatch(/appendLeadEvent/);
    expect(manager).toMatch(/appendCommercialEvent/);
    expect(manager).toMatch(/setLeadStage/);
  });

  it('keeps dangerous and agency-only controls out of the client manager', () => {
    const manager = read('components', 'ClientPortalLeadManager.tsx');

    expect(manager).not.toMatch(/deleteLead|Eliminar lead|sendLeadMetaCapiTestEvent|recordLeadPayment/);
    expect(manager).not.toMatch(/createLead|updateLead/);
    expect(manager).not.toMatch(/client selector|Todos los clientes/i);
  });

  it('provides a client-specific shell with an explicit logout', () => {
    const layout = read('app', '(client)', 'portal', 'layout.tsx');
    expect(layout).toMatch(/Portal de cliente/);
    expect(layout).toMatch(/LogoutButton/);
    expect(layout).not.toMatch(/<Sidebar|<Topbar/);
  });
});

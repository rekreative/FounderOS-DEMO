import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('Client portal perimeter', () => {
  it('uses the shared role guard and never mounts the internal shell', () => {
    const source = fs.readFileSync(path.join(root, 'app', '(client)', 'portal', 'layout.tsx'), 'utf8');
    expect(source).toMatch(/requireUser\(\)/);
    expect(source).toMatch(/user\.role === 'internal'\) redirect\('\/'\)/);
    expect(source).not.toMatch(/<Sidebar/);
    expect(source).not.toMatch(/<Topbar/);
  });

  it('derives the displayed tenant from requireClientAccess before any data queries', () => {
    const source = fs.readFileSync(path.join(root, 'app', '(client)', 'portal', '[clientId]', 'page.tsx'), 'utf8');
    expect(source).toMatch(/await requireClientAccess\(params\.clientId\)/);
    expect(source).toMatch(/listLeads\(\{ clientId: params\.clientId \}\)/);
    expect(source).toMatch(/getResults\(\{ clientId: params\.clientId/);
  });

  it('lists only grants held by the authenticated user', () => {
    const source = fs.readFileSync(path.join(root, 'lib', 'server', 'profiles-repo.ts'), 'utf8');
    expect(source).toMatch(/WHERE user_id = \$1/);
    expect(source).toMatch(/listAccessibleClients/);
  });

  it('keeps invitation authority internal and fixes the redirect server-side', () => {
    const route = fs.readFileSync(path.join(root, 'app', 'api', 'clients', '[id]', 'access', 'invite', 'route.ts'), 'utf8');
    const service = fs.readFileSync(path.join(root, 'lib', 'server', 'client-invitations.ts'), 'utf8');
    expect(route).toMatch(/requireInternalUserOrResponse/);
    expect(route).not.toMatch(/redirectTo/);
    expect(service).toMatch(/REKREOS_APP_URL/);
    expect(service).toMatch(/provisionClientAccess/);
  });

  it('exposes the invitation control only inside the protected internal client workspace', () => {
    const internalClientPage = fs.readFileSync(path.join(root, 'app', '(internal)', 'clients', '[clientId]', 'page.tsx'), 'utf8');
    const inviteControl = fs.readFileSync(path.join(root, 'components', 'ClientPortalInvite.tsx'), 'utf8');
    expect(internalClientPage).toMatch(/ClientPortalInvite/);
    expect(inviteControl).toMatch(/\/api\/clients\/\$\{encodeURIComponent\(clientId\)\}\/access\/invite/);
    expect(inviteControl).toMatch(/Enviar invitación/);
  });
});

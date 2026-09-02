import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { CommandPalette } from '@/components/CommandPalette';
import { ClientsProvider } from '@/components/ClientsProvider';
import { MobileNav } from '@/components/MobileNav';
import type { Command } from '@/lib/palette';
import { REKREATIVE_PRIMARY } from '@/lib/nav';
import { requireInternalUser } from '@/lib/server/auth';
import { AuthError } from '@/lib/server/auth-errors';

/**
 * Internal REKREOS perimeter. Enforces the target invariant — authenticated
 * AND profiles.role === 'internal' — structurally, before the shell (and
 * therefore every page beneath it) ever renders. Not identity-only:
 * requireInternalUser() is the same helper the API guard (lib/server/api-auth.ts)
 * uses, so there is exactly one place role logic lives, reused here, not
 * duplicated. Both failure cases (no session, and a session that isn't
 * role='internal') redirect to /login for now — no forbidden page exists
 * yet, and none is needed while no client-role account can exist (see the
 * architecture audit's own reasoning for why this is a deliberate,
 * time-bound simplification, not a permanent stance).
 *
 * Shell moved verbatim from the old app/layout.tsx — not redesigned.
 */

// Search keywords per REKREATIVE route — the labels/hrefs themselves come
// from REKREATIVE_PRIMARY (lib/nav.ts), the same source the sidebar renders,
// so ⌘K can never contradict it or resurface a legacy FounderOS route.
const NAV_COMMAND_KEYWORDS: Record<string, string> = {
  '/': 'inicio dashboard resumen centro de operaciones',
  '/business': 'rekreative negocio perfil servicios objetivos estrategia',
  '/clients': 'clientes cuentas workspace',
  '/leads': 'leads crm pipeline etapas',
  '/meta-ads': 'meta ads campañas publicidad gasto cpl ctr',
  '/results': 'resultados funnel comercial ingresos roas cac',
  '/automations': 'automatizaciones make manychat whatsapp',
  '/ai-agents': 'agentes ia openai anthropic whatsapp instagram',
  '/connections': 'integraciones conexiones requeridas verificadas',
  '/content': 'contenido piezas producción calendario',
  '/finances': 'finanzas ingresos procesadores stripe paypal',
  '/brain': 'g-brain conocimiento sops decisiones aprendizajes',
  '/analytics': 'analítica portafolio métricas benchmarks',
};

const NAV_COMMANDS: Command[] = REKREATIVE_PRIMARY.map((item) => ({
  id: `nav-${item.href === '/' ? 'home' : item.href.replace(/^\//, '')}`,
  label: item.label,
  keywords: NAV_COMMAND_KEYWORDS[item.href] ?? '',
  href: item.href,
  hint: 'view',
}));

// Local apps and external tools this machine has open — open in a new tab.
const EXTERNAL_COMMANDS: Command[] = [
  { id: 'ext-command-center', label: 'Command Center', keywords: 'command-center kanban missions port 4000', href: 'http://localhost:4000', hint: 'localhost' },
  { id: 'ext-remotion', label: 'Remotion Studio', keywords: 'video render pipeline port 3789', href: 'http://localhost:3789', hint: 'localhost' },
  { id: 'ext-attio', label: 'Attio CRM', keywords: 'deals pipeline', href: 'https://app.attio.com', hint: 'web' },
  { id: 'ext-fathom', label: 'Fathom Calls', keywords: 'meetings recordings notes', href: 'https://fathom.video', hint: 'web' },
];

function buildCommands(): Command[] {
  return [...NAV_COMMANDS, ...EXTERNAL_COMMANDS];
}

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireInternalUser();
  } catch (error) {
    if (error instanceof AuthError) {
      redirect('/login');
    }
    throw error;
  }

  return (
    // Canonical PostgreSQL Client registry — one fetch, mounted above every
    // internal route, so every module resolves the same client list (see
    // components/ClientsProvider.tsx for why).
    <ClientsProvider>
      <Sidebar />
      <div className="flex min-h-screen min-w-0 flex-col lg:ml-[var(--sidebar-w,232px)]">
        <Topbar />
        <main className="min-w-0 flex-1 px-4 pb-20 pt-5 sm:px-6 lg:px-8 lg:pb-16 lg:pt-7 wide:px-10 ultra:px-12">
          {/* Width tiers: 1280 on laptops · 1760 on large monitors ·
              full-bleed on 32"/ultrawide. See tailwind screens wide/ultra. */}
          <div className="mx-auto max-w-[1280px] wide:max-w-[1760px] ultra:max-w-none">
            {children}
          </div>
        </main>
      </div>
      <CommandPalette commands={buildCommands()} />
      <MobileNav />
    </ClientsProvider>
  );
}

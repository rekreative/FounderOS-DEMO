import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { CommandPalette } from '@/components/CommandPalette';
import { ConductorPanel } from '@/components/ConductorPanel';
import { ClientsProvider } from '@/components/ClientsProvider';
import type { Command } from '@/lib/palette';
import { REKREATIVE_PRIMARY } from '@/lib/nav';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'REKREATIVE OS',
  description: 'Personal operating system and AI agent command center',
};

// Search keywords per REKREATIVE route — the labels/hrefs themselves come
// from REKREATIVE_PRIMARY (lib/nav.ts), the same source the sidebar renders,
// so ⌘K can never contradict it or resurface a legacy FounderOS route.
const NAV_COMMAND_KEYWORDS: Record<string, string> = {
  '/': 'inicio dashboard resumen centro de operaciones',
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontMono.variable} suppressHydrationWarning>
      <head>
        {/* Apply the persisted theme before first paint — no dark↔light flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {/* Canonical PostgreSQL Client registry — one fetch, mounted above
            every route, so every module resolves the same client list
            (see components/ClientsProvider.tsx for why). */}
        <ClientsProvider>
          <Sidebar />
          {/* os-shell yields to the Conductor dock: the panel sets --conductor-w
              and the whole content column glides left instead of being covered */}
          <div className="os-shell ml-[232px] flex min-h-screen min-w-0 flex-col" style={{ marginRight: 'var(--conductor-w, 0px)' }}>
            <Topbar />
            <main className="min-w-0 flex-1 px-8 pb-16 pt-7 wide:px-10 ultra:px-12">
              {/* Width tiers: 1280 on laptops · 1760 on large monitors ·
                  full-bleed on 32"/ultrawide. See tailwind screens wide/ultra. */}
              <div className="mx-auto max-w-[1280px] wide:max-w-[1760px] ultra:max-w-none">
                {children}
              </div>
            </main>
          </div>
          <CommandPalette commands={buildCommands()} />
          {/* Notion-style agent dock — the Conductor, aware of the current screen */}
          <ConductorPanel />
        </ClientsProvider>
      </body>
    </html>
  );
}

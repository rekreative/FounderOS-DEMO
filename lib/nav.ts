/**
 * Single source of truth for the app's primary navigation. The Sidebar renders
 * these groups in order; the CommandPalette derives its digit (1–9) shortcuts
 * from the same visible order, so the two can never drift apart again.
 */
import {
  Home,
  MessageSquare,
  Share2,
  Clapperboard,
  Users,
  ListChecks,
  Sparkles,
  Network,
  Brain,
  Wallet,
  Filter,
  Workflow,
  Map,
  Plug,
  BarChart3,
  LayoutGrid,
  Layers,
} from 'lucide-react';

export type NavItem = { href: string; label: string; icon: typeof Home };

export const NAV_OPERATE: NavItem[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/comms', label: 'Comms', icon: MessageSquare },
  { href: '/funnel', label: 'Funnel', icon: Filter },
  { href: '/workflows', label: 'Workflows', icon: Workflow },
  { href: '/social', label: 'Social', icon: Share2 },
  { href: '/content', label: 'Content', icon: Clapperboard },
  { href: '/finances', label: 'Finances', icon: Wallet },
];

// REKREATIVE primary menu (visible rail for the agency). Keeps original NAV_* intact for tests and CommandPalette.
export const REKREATIVE_PRIMARY: NavItem[] = [
  { href: '/', label: 'Inicio', icon: Home },
  { href: '/clients', label: 'Clientes', icon: Users },
  { href: '/leads', label: 'Leads', icon: Filter },
  { href: '/meta-ads', label: 'Meta Ads', icon: LayoutGrid },
  { href: '/automations', label: 'Automatizaciones', icon: Workflow },
  { href: '/ai-agents', label: 'Agentes', icon: Users },
  { href: '/content', label: 'Contenido', icon: Clapperboard },
  { href: '/finances', label: 'Finanzas', icon: Wallet },
  { href: '/brain', label: 'G-Brain', icon: Brain },
  { href: '/analytics', label: 'Analítica', icon: BarChart3 },
];

// The agent workforce: the roster and the org chart that maps how they report.
export const NAV_AGENTS: NavItem[] = [
  // Keep agents-related internals accessible but not duplicated in the primary rail
  { href: '/agents', label: 'Agents', icon: Users },
  { href: '/tasks', label: 'Tasks', icon: ListChecks },
  { href: '/skills', label: 'Skills', icon: Sparkles },
  { href: '/org', label: 'Org Chart', icon: Network },
];

// The knowledge layer the agents draw on.
export const NAV_INTELLIGENCE: NavItem[] = [{ href: '/brain', label: 'G-Brain', icon: Brain }];

export const NAV_SYSTEM: NavItem[] = [
  // Keep less-frequent system views reachable but out of the primary operate list
  { href: '/integrations', label: 'Connections', icon: Plug },
  { href: '/roadmap', label: 'Roadmap', icon: Map },
  { href: '/reference', label: 'Reference Model', icon: LayoutGrid },
];

// At the very bottom: persona templates that can run variants of this platform.
export const NAV_LIBRARY: NavItem[] = [{ href: '/personas', label: 'Personas', icon: Layers }];

/** Visible top-to-bottom order across all groups. */
export const NAV_ORDER: string[] = [
  ...NAV_OPERATE,
  ...NAV_AGENTS,
  ...NAV_INTELLIGENCE,
  ...NAV_SYSTEM,
  ...NAV_LIBRARY,
].map((n) => n.href);

/** Digit keys 1–9 jump to the first nine views in visible order. */
export const DIGIT_VIEWS: string[] = NAV_ORDER.slice(0, 9);

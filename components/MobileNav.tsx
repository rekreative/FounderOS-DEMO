'use client';

import Link from 'next/link';
import { BarChart3, Home, PlugZap, Target, Users } from 'lucide-react';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Inicio', icon: Home },
  { href: '/clients', label: 'Clientes', icon: Users },
  { href: '/leads', label: 'Leads', icon: Target },
  { href: '/results', label: 'Resultados', icon: BarChart3 },
  { href: '/connections', label: 'Más', icon: PlugZap },
] as const;

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación móvil"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-os-border bg-os-bg2/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-[58px] flex-col items-center justify-center gap-1 px-1 font-mono text-[9px] uppercase tracking-[0.08em] ${
              active ? 'text-os-text' : 'text-os-dim'
            }`}
          >
            <Icon className="h-[17px] w-[17px]" strokeWidth={active ? 2 : 1.6} />
            <span className="max-w-full truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

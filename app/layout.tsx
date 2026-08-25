import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { THEME_INIT_SCRIPT } from '@/lib/theme';

/**
 * Root layout — ONLY truly global, public-safe structure. No data-fetching
 * consumer (ClientsProvider, Sidebar, Topbar, CommandPalette, ConductorPanel)
 * lives here — those are internal-only and moved into
 * app/(internal)/layout.tsx, which gates them behind requireInternalUser().
 * This is what makes opening /login (app/(auth)/login) NOT trigger any
 * internal shell/API background traffic — by construction (the components
 * simply aren't mounted for that route), not by a pathname runtime check.
 */

const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'REKREATIVE OS',
  description: 'Personal operating system and AI agent command center',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontMono.variable} suppressHydrationWarning>
      <head>
        {/* Apply the persisted theme before first paint — no dark↔light flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

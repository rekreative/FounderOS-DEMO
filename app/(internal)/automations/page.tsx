import type { ReactNode } from 'react';
import { Workflow } from 'lucide-react';
import { BrandLogo } from '@/lib/brand-logos';
import { AUTOMATION_PLATFORM_OPTIONS, type AutomationPlatform } from '@/lib/automations';
import { AutomationsBoard } from '@/components/AutomationsBoard';

// Real brand marks per platform. 'internal' intentionally has no entry — it's not
// a company, so it gets a neutral system-style badge instead of a fake logo.
const PLATFORM_BRAND: Partial<Record<AutomationPlatform, { slug: string; name: string }>> = {
  make: { slug: 'make', name: 'Make' },
  whatsapp: { slug: 'whatsapp', name: 'WhatsApp' },
  meta: { slug: 'meta', name: 'Meta' },
  openai: { slug: 'openai', name: 'OpenAI' },
  manychat: { slug: 'manychat', name: 'ManyChat' },
  google_sheets: { slug: 'googlesheets', name: 'Google Sheets' },
  calendar: { slug: 'googlecalendar', name: 'Google Calendar' },
};

/** Same tile geometry BrandLogo uses (radius/glyph scale off `size`), so the
 * neutral "internal" badge sits flush next to real brand tiles at any size. */
function internalBadge(size: number) {
  const radius = Math.round(size * 0.28);
  const glyph = Math.round(size * 0.56);
  return (
    <span
      className="grid shrink-0 place-items-center bg-os-surface2 text-os-dim"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <Workflow style={{ width: glyph, height: glyph }} strokeWidth={1.75} />
    </span>
  );
}

export default function AutomationsPage() {
  // BrandLogo pulls simple-icons, which must never enter the client bundle — so
  // the logos are rendered here, server-side, and handed to the client board as
  // ready-made nodes (same pattern as /workflows' toolLogos). Two sizes: compact
  // 14px marks for chips/labels, and a 32px set for each card's primary-platform
  // identity tile.
  const platformLogos: Record<string, ReactNode> = {};
  const platformIconsLarge: Record<string, ReactNode> = {};

  for (const option of AUTOMATION_PLATFORM_OPTIONS) {
    const brand = PLATFORM_BRAND[option.id];
    platformLogos[option.id] = brand ? <BrandLogo slug={brand.slug} name={brand.name} size={14} /> : internalBadge(14);
    platformIconsLarge[option.id] = brand ? <BrandLogo slug={brand.slug} name={brand.name} size={32} /> : internalBadge(32);
  }

  return <AutomationsBoard platformLogos={platformLogos} platformIconsLarge={platformIconsLarge} />;
}

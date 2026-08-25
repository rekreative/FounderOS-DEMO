import type { ReactNode } from 'react';
import { CircleDashed } from 'lucide-react';
import { BrandLogo } from '@/lib/brand-logos';
import { INTEGRATION_PLATFORM_OPTIONS, type IntegrationPlatform } from '@/lib/integration-connections';
import { IntegrationConnectionsBoard } from '@/components/IntegrationConnectionsBoard';

// Real brand marks per platform, same approach as app/ai-agents/page.tsx:
// BrandLogo pulls simple-icons, which must never enter the client bundle, so
// logos are rendered here server-side and handed to the client board as
// ready-made nodes. 'other' has no company behind it, so it gets a neutral
// badge instead of a fake logo.
const PLATFORM_BRAND: Partial<Record<IntegrationPlatform, { slug: string; name: string }>> = {
  meta: { slug: 'meta', name: 'Meta' },
  instagram: { slug: 'instagram', name: 'Instagram' },
  whatsapp: { slug: 'whatsapp', name: 'WhatsApp' },
  make: { slug: 'make', name: 'Make' },
  manychat: { slug: 'manychat', name: 'ManyChat' },
  openai: { slug: 'openai', name: 'OpenAI' },
  anthropic: { slug: 'anthropic', name: 'Anthropic' },
  google_sheets: { slug: 'googlesheets', name: 'Google Sheets' },
  google_calendar: { slug: 'googlecalendar', name: 'Google Calendar' },
  stripe: { slug: 'stripe', name: 'Stripe' },
  paypal: { slug: 'paypal', name: 'PayPal' },
};

const PRIMARY_SIZE = 32;

/** Same tile geometry BrandLogo uses (radius/glyph scale off `size`), so a
 * neutral badge sits flush next to real brand tiles at any size. */
function neutralBadge(size: number) {
  const radius = Math.round(size * 0.28);
  const glyph = Math.round(size * 0.56);
  return (
    <span
      className="grid shrink-0 place-items-center bg-os-surface2 text-os-dim"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <CircleDashed style={{ width: glyph, height: glyph }} strokeWidth={1.75} />
    </span>
  );
}

export default function ConnectionsPage() {
  const platformLogosLarge: Record<string, ReactNode> = {};
  for (const option of INTEGRATION_PLATFORM_OPTIONS) {
    const brand = PLATFORM_BRAND[option.id];
    platformLogosLarge[option.id] = brand ? (
      <BrandLogo slug={brand.slug} name={brand.name} size={PRIMARY_SIZE} />
    ) : (
      neutralBadge(PRIMARY_SIZE)
    );
  }

  return <IntegrationConnectionsBoard platformLogosLarge={platformLogosLarge} />;
}

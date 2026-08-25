import type { ReactNode } from 'react';
import { CircleDashed, Database, Layers, Workflow } from 'lucide-react';
import { BrandLogo } from '@/lib/brand-logos';
import { AI_AGENT_CHANNEL_OPTIONS, AI_AGENT_PROVIDER_OPTIONS, type AiAgentChannel, type AiAgentProvider } from '@/lib/agents-ai';
import { AgentsAiBoard } from '@/components/AgentsAiBoard';

// Real brand marks per provider/channel, same approach as app/automations/page.tsx:
// BrandLogo pulls simple-icons, which must never enter the client bundle, so
// logos are rendered here server-side and handed to the client board as
// ready-made nodes. 'other'/'crm'/'internal'/'multi_channel' have no company
// behind them, so they get a neutral system-style badge instead of a fake logo.
const PROVIDER_BRAND: Partial<Record<AiAgentProvider, { slug: string; name: string }>> = {
  openai: { slug: 'openai', name: 'OpenAI' },
  anthropic: { slug: 'anthropic', name: 'Anthropic' },
};

const CHANNEL_BRAND: Partial<Record<AiAgentChannel, { slug: string; name: string }>> = {
  whatsapp: { slug: 'whatsapp', name: 'WhatsApp' },
  instagram: { slug: 'instagram', name: 'Instagram' },
};

const NEUTRAL_CHANNEL_ICON: Partial<Record<AiAgentChannel, typeof Workflow>> = {
  crm: Database,
  internal: Workflow,
  multi_channel: Layers,
};

// Compact chip mark (provider/model + channel metadata row) vs. the card's
// primary identity mark (agent avatar position — where the agent operates).
const CHIP_SIZE = 16;
const PRIMARY_SIZE = 32;

/** Same tile geometry BrandLogo uses (radius/glyph scale off `size`), so a
 * neutral badge sits flush next to real brand tiles at any size. */
function neutralBadge(size: number, Icon: typeof Workflow) {
  const radius = Math.round(size * 0.28);
  const glyph = Math.round(size * 0.56);
  return (
    <span
      className="grid shrink-0 place-items-center bg-os-surface2 text-os-dim"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <Icon style={{ width: glyph, height: glyph }} strokeWidth={1.75} />
    </span>
  );
}

export default function AiAgentsPage() {
  const providerLogos: Record<string, ReactNode> = {};
  for (const option of AI_AGENT_PROVIDER_OPTIONS) {
    const brand = PROVIDER_BRAND[option.id];
    providerLogos[option.id] = brand ? <BrandLogo slug={brand.slug} name={brand.name} size={CHIP_SIZE} /> : neutralBadge(CHIP_SIZE, Layers);
  }

  // Compact chip marks — sit inline with the provider/model and channel/use-case metadata.
  const channelLogos: Record<string, ReactNode> = {};
  // Primary card identity mark — WHERE the agent operates, replacing the old generic initials tile.
  const channelIconsLarge: Record<string, ReactNode> = {};
  for (const option of AI_AGENT_CHANNEL_OPTIONS) {
    const brand = CHANNEL_BRAND[option.id];
    const neutralIcon = NEUTRAL_CHANNEL_ICON[option.id] ?? Workflow;
    channelLogos[option.id] = brand ? <BrandLogo slug={brand.slug} name={brand.name} size={CHIP_SIZE} /> : neutralBadge(CHIP_SIZE, neutralIcon);
    channelIconsLarge[option.id] = brand ? (
      <BrandLogo slug={brand.slug} name={brand.name} size={PRIMARY_SIZE} />
    ) : (
      neutralBadge(PRIMARY_SIZE, neutralIcon)
    );
  }

  // Agents with no channel set yet (e.g. an unfinished draft) get a distinct
  // "undefined" mark rather than falling back to a real channel's icon.
  const noChannelIcon = neutralBadge(PRIMARY_SIZE, CircleDashed);

  return (
    <AgentsAiBoard
      providerLogos={providerLogos}
      channelLogos={channelLogos}
      channelIconsLarge={channelIconsLarge}
      noChannelIcon={noChannelIcon}
    />
  );
}

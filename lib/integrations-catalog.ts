import type { ConnectorStatus } from '@/lib/connectors/types';
import {
  INTEGRATION_CATEGORIES,
  type Integration,
  type IntegrationCategory,
} from '@/lib/schemas';

/**
 * The connections marketplace catalog — read-only status display. Larp-first:
 * a rich, honest catalog of popular tools. `connectorId` ties an entry to a
 * real connector so its live "connected" state is never faked; everything
 * else reads as "not connected", with no affordance to change that from this
 * page (Legacy secret-write shutdown, Connections/Secrets V1 — secrets are
 * configured outside REKREOS). Logos resolve from `slug` via
 * lib/brand-logos (simple-icons + a few hand-authored marks + intentional
 * lettermarks).
 */
export const INTEGRATIONS: Integration[] = [
  // Communication
  { slug: 'slack', name: 'Slack', tagline: 'Channels & DMs', category: 'Communication', connectorId: 'slack', popular: true },
  { slug: 'gmail', name: 'Gmail', tagline: 'Send & read email', category: 'Communication', connectorId: 'email', popular: true },
  { slug: 'whatsapp', name: 'WhatsApp', tagline: 'Messages & broadcasts', category: 'Communication', connectorId: 'whatsapp' },
  { slug: 'discord', name: 'Discord', tagline: 'Servers & channels', category: 'Communication' },
  { slug: 'telegram', name: 'Telegram', tagline: 'Chats & bots', category: 'Communication' },
  { slug: 'zoom', name: 'Zoom', tagline: 'Meetings & recordings', category: 'Communication', popular: true },
  { slug: 'manychat', name: 'ManyChat', tagline: 'IG DM automation', category: 'Communication', connectorId: 'manychat' },

  // Productivity
  { slug: 'notion', name: 'Notion', tagline: 'Docs & databases', category: 'Productivity', connectorId: 'notion', popular: true },
  { slug: 'airtable', name: 'Airtable', tagline: 'Bases & records', category: 'Productivity', popular: true },
  { slug: 'googlesheets', name: 'Google Sheets', tagline: 'Read & write spreadsheets', category: 'Productivity' },
  { slug: 'googledocs', name: 'Google Docs', tagline: 'Create & edit documents', category: 'Productivity' },
  { slug: 'clickup', name: 'ClickUp', tagline: 'Docs, tasks & goals', category: 'Productivity' },
  { slug: 'trello', name: 'Trello', tagline: 'Boards & cards', category: 'Productivity' },
  { slug: 'coda', name: 'Coda', tagline: 'Docs that act like apps', category: 'Productivity' },

  // CRM & Sales
  { slug: 'hubspot', name: 'HubSpot', tagline: 'Contacts & deals', category: 'CRM & Sales', popular: true },
  { slug: 'salesforce', name: 'Salesforce', tagline: 'Accounts & pipeline', category: 'CRM & Sales' },
  { slug: 'attio', name: 'Attio', tagline: 'CRM built on data', category: 'CRM & Sales', connectorId: 'attio' },
  { slug: 'zendesk', name: 'Zendesk', tagline: 'Tickets & support', category: 'CRM & Sales' },
  { slug: 'intercom', name: 'Intercom', tagline: 'Chat & lifecycle', category: 'CRM & Sales' },
  { slug: 'gohighlevel', name: 'GoHighLevel', tagline: 'LC pipeline & contacts', category: 'CRM & Sales', connectorId: 'ghl' },

  // Developer
  { slug: 'github', name: 'GitHub', tagline: 'Repos, issues & PRs', category: 'Developer', popular: true },
  { slug: 'linear', name: 'Linear', tagline: 'Issues & projects', category: 'Developer' },
  { slug: 'jira', name: 'Jira', tagline: 'Boards & tickets', category: 'Developer' },
  { slug: 'vercel', name: 'Vercel', tagline: 'Deploys & logs', category: 'Developer' },
  { slug: 'sentry', name: 'Sentry', tagline: 'Errors & traces', category: 'Developer' },
  { slug: 'gitlab', name: 'GitLab', tagline: 'Repos & pipelines', category: 'Developer' },

  // Scheduling
  { slug: 'googlecalendar', name: 'Google Calendar', tagline: 'Events & availability', category: 'Scheduling', connectorId: 'calendar', popular: true },
  { slug: 'calendly', name: 'Calendly', tagline: 'Booking links', category: 'Scheduling' },
  { slug: 'caldotcom', name: 'Cal.com', tagline: 'Open scheduling', category: 'Scheduling' },
  { slug: 'googlemeet', name: 'Google Meet', tagline: 'Video calls', category: 'Scheduling' },

  // Finance
  { slug: 'stripe', name: 'Stripe', tagline: 'Payments & invoices', category: 'Finance', connectorId: 'payments', popular: true },
  { slug: 'quickbooks', name: 'QuickBooks', tagline: 'Bookkeeping & P&L', category: 'Finance' },
  { slug: 'xero', name: 'Xero', tagline: 'Accounting & bills', category: 'Finance' },
  { slug: 'paypal', name: 'PayPal', tagline: 'Payments & payouts', category: 'Finance' },
  { slug: 'wise', name: 'Wise', tagline: 'Multi-currency balances', category: 'Finance' },
  { slug: 'plaid', name: 'Plaid', tagline: 'Bank connections', category: 'Finance' },

  // Marketing
  { slug: 'mailchimp', name: 'Mailchimp', tagline: 'Email campaigns', category: 'Marketing' },
  { slug: 'googleanalytics', name: 'Google Analytics', tagline: 'Traffic & conversions', category: 'Marketing' },
  { slug: 'meta', name: 'Meta Ads', tagline: 'Campaigns & audiences', category: 'Marketing', connectorId: 'meta-ads' },
  { slug: 'beehiiv', name: 'beehiiv', tagline: 'Newsletter & subscribers', category: 'Marketing', connectorId: 'beehiiv' },
  { slug: 'buffer', name: 'Buffer', tagline: 'Schedule social posts', category: 'Marketing' },
  { slug: 'hootsuite', name: 'Hootsuite', tagline: 'Social management', category: 'Marketing' },
  { slug: 'zernio', name: 'Zernio', tagline: 'Cross-platform posting', category: 'Marketing', connectorId: 'zernio' },
  { slug: 'webinarjam', name: 'WebinarJam', tagline: 'Webinar registrants', category: 'Marketing', connectorId: 'webinarjam' },
  { slug: 'trakyo', name: 'Trakyo', tagline: 'Organic attribution', category: 'Marketing', connectorId: 'trakyo' },

  // Storage
  { slug: 'googledrive', name: 'Google Drive', tagline: 'Files & folders', category: 'Storage' },
  { slug: 'dropbox', name: 'Dropbox', tagline: 'Sync & share', category: 'Storage' },
  { slug: 'box', name: 'Box', tagline: 'Content cloud', category: 'Storage' },
  { slug: 'onedrive', name: 'OneDrive', tagline: 'Microsoft files', category: 'Storage' },
  { slug: 'obsidian', name: 'Notes', tagline: 'Markdown vault', category: 'Storage', connectorId: 'obsidian' },

  // AI & Automation
  { slug: 'openai', name: 'OpenAI', tagline: 'GPT models & embeddings', category: 'AI & Automation' },
  { slug: 'anthropic', name: 'Anthropic', tagline: 'Claude models', category: 'AI & Automation', popular: true },
  { slug: 'zapier', name: 'Zapier', tagline: 'Automate anything', category: 'AI & Automation' },
  { slug: 'make', name: 'Make', tagline: 'Visual workflows', category: 'AI & Automation' },
  { slug: 'n8n', name: 'n8n', tagline: 'Self-hosted automation', category: 'AI & Automation' },

  // Creative
  { slug: 'figma', name: 'Figma', tagline: 'Design & prototypes', category: 'Creative', popular: true },
  { slug: 'canva', name: 'Canva', tagline: 'Templates & graphics', category: 'Creative' },
  { slug: 'miro', name: 'Miro', tagline: 'Whiteboards & maps', category: 'Creative', connectorId: 'miro' },
  { slug: 'loom', name: 'Loom', tagline: 'Screen recordings', category: 'Creative' },
  { slug: 'typeform', name: 'Typeform', tagline: 'Forms & surveys', category: 'Creative' },
  { slug: 'arcads', name: 'Arcads', tagline: 'AI video ads', category: 'Creative', connectorId: 'arcads' },
];

export type CatalogEntry = Integration & { connected: boolean };

/** Merge live connector state onto the catalog. `connected` is true only when
 *  a linked connector actually reports 'connected' — never faked. Read-only:
 *  this app has no browser-facing secret-write path (Legacy secret-write
 *  shutdown, Connections/Secrets V1) — there is no `keySaved`/pasted-key
 *  concept left to merge in. */
export function connectionCatalog(statuses: ConnectorStatus[]): CatalogEntry[] {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  return INTEGRATIONS.map((i) => ({
    ...i,
    connected: i.connectorId ? byId.get(i.connectorId)?.state === 'connected' : false,
  }));
}

/** Catalog grouped by category, in the canonical category order, skipping any
 *  category with no tools. */
export function integrationsByCategory(
  entries: Integration[] = INTEGRATIONS,
): Map<IntegrationCategory, Integration[]> {
  const out = new Map<IntegrationCategory, Integration[]>();
  for (const cat of INTEGRATION_CATEGORIES) {
    const tools = entries.filter((i) => i.category === cat);
    if (tools.length) out.set(cat, tools);
  }
  return out;
}

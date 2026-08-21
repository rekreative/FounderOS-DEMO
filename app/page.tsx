'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Dot, Kbd, SectionHead } from '@/components/terminal';
import { REKREATIVE_PRIMARY } from '@/lib/nav';
import { getClients, initializeStoreIfNeeded, getClientStatusLabel, type Client } from '@/lib/clients';
import { getLeads, initializeLeadsStoreIfNeeded, type Lead } from '@/lib/leads';
import { getCampaigns, initializeMetaCampaignsStoreIfNeeded, type MetaCampaign } from '@/lib/meta-ads';
import {
  getAutomations,
  initializeAutomationsStoreIfNeeded,
  summarizeAutomations,
  getAutomationHealth,
  getClientNameForAutomation,
  type Automation,
} from '@/lib/automations';
import {
  getAiAgents,
  initializeAiAgentsStoreIfNeeded,
  getAiAgentConfigurationStatus,
  getClientNameForAiAgent,
  type AiAgent,
} from '@/lib/agents-ai';
import {
  getClientIntegrationRequirements,
  initializeClientIntegrationRequirementsStoreIfNeeded,
  summarizeClientOnboarding,
  type ClientIntegrationRequirement,
} from '@/lib/client-integration-requirements';
import {
  getIntegrationConnections,
  initializeIntegrationConnectionsStoreIfNeeded,
  type IntegrationConnection,
} from '@/lib/integration-connections';
import { getContentItems, initializeContentStoreIfNeeded, isContentOverdue, type ContentItem } from '@/lib/content-items';
import { getRevenueRecords, initializeResultsStoreIfNeeded, sumAttributedRevenue, type RevenueRecord } from '@/lib/results';

// REKREATIVE OS internal command center — "what's happening right now" and
// "what needs my attention", built ONLY from existing REKREATIVE stores and
// derived helpers (same localStorage modules every other REKREATIVE page
// reads). No new storage, no new business logic: every number here is either
// a straight count or a call to a summarizer/derivation that already exists
// (summarizeAutomations, getAutomationHealth, getAiAgentConfigurationStatus,
// summarizeClientOnboarding, isContentOverdue, sumAttributedRevenue).

type AttentionItem = { id: string; text: string; href: string; clientId?: string | null };

// Home-only presentation lookups — the automation names/errors in
// lib/automations.ts's seed data predate the Spanish-first pass. Translated
// here for DISPLAY only; the stored Automation/AutomationRun records are
// never touched. Anything not seeded yet falls back to its original text
// rather than disappearing.
const AUTOMATION_NAME_ES: Record<string, string> = {
  'Meta Lead → WhatsApp Welcome': 'Bienvenida por WhatsApp desde lead de Meta',
  'Appointment Reminder — WhatsApp': 'Recordatorio de citas por WhatsApp',
  'Instagram DM Nurture — ManyChat': 'Nutrición por DM de Instagram — ManyChat',
  'Post-Conversion Review Request': 'Solicitud de reseña tras conversión',
  'New Client Onboarding Notification': 'Notificación de alta de nuevo cliente',
  'Weekly Performance Digest': 'Resumen semanal de rendimiento',
};

const AUTOMATION_ERROR_ES: Record<string, string> = {
  'WhatsApp template send timed out': 'Tiempo de espera agotado al enviar la plantilla de WhatsApp',
  'WhatsApp template not approved for this variant': 'Plantilla de WhatsApp no aprobada',
};

// Attributed revenue, Spanish grouping (6.350 €, not 6350 €) — explicit
// useGrouping avoids a runtime quirk where bare .toLocaleString('es-ES')
// silently drops the thousands separator. Kept local to Home rather than
// changed in lib/results.ts's shared formatEUR, which other approved pages
// already rely on as-is.
function formatEURDisplay(value: number): string {
  return `${Math.round(value).toLocaleString('es-ES', { useGrouping: true })} €`;
}

function StatTile({
  href,
  label,
  value,
  unit,
}: {
  href: string;
  label: string;
  value: React.ReactNode;
  unit: string;
}) {
  return (
    <Link
      href={href}
      className="hoverable group flex flex-col gap-2 rounded-lg-t border border-os-border bg-os-surface px-[18px] py-4"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-os-dim">{label}</span>
        <ArrowUpRight className="h-3.5 w-3.5 text-os-dim opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="flex items-baseline gap-[7px] font-mono text-[26px] font-semibold tracking-[-0.02em] text-os-text">
        {value}
        <small className="whitespace-nowrap text-xs font-normal text-os-dim">{unit}</small>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [revenueRecords, setRevenueRecords] = useState<RevenueRecord[]>([]);
  const [requirementsByClient, setRequirementsByClient] = useState<Record<string, ClientIntegrationRequirement[]>>({});

  useEffect(() => {
    initializeStoreIfNeeded();
    initializeLeadsStoreIfNeeded();
    initializeMetaCampaignsStoreIfNeeded();
    initializeAutomationsStoreIfNeeded();
    initializeAiAgentsStoreIfNeeded();
    initializeIntegrationConnectionsStoreIfNeeded();
    initializeClientIntegrationRequirementsStoreIfNeeded();
    initializeContentStoreIfNeeded();
    initializeResultsStoreIfNeeded();

    const allClients = getClients();
    setClients(allClients);
    setLeads(getLeads());
    setCampaigns(getCampaigns());
    setAutomations(getAutomations());
    setAgents(getAiAgents());
    setConnections(getIntegrationConnections());
    setContentItems(getContentItems());
    setRevenueRecords(getRevenueRecords());

    const reqByClient: Record<string, ClientIntegrationRequirement[]> = {};
    for (const client of allClients) reqByClient[client.id] = getClientIntegrationRequirements(client.id);
    setRequirementsByClient(reqByClient);
  }, []);

  // ── Executive summary — honest counts only, no invented periods/rates ──
  const activeClients = clients.filter((c) => c.status === 'active').length;
  const activeCampaigns = campaigns.filter((c) => c.status === 'active').length;
  const automationsSummary = useMemo(() => summarizeAutomations(automations), [automations]);
  const attributedRevenue = useMemo(() => sumAttributedRevenue(revenueRecords), [revenueRecords]);

  // ── Needs attention — deterministic state only, no fake AI insights or
  // invented severity scores. Every source is an existing derivation. ──
  const attentionAutomations: AttentionItem[] = useMemo(
    () =>
      automations
        .filter((a) => getAutomationHealth(a) === 'needs_attention')
        .map((a) => {
          const name = AUTOMATION_NAME_ES[a.name] ?? a.name;
          const errorEs = a.lastError ? AUTOMATION_ERROR_ES[a.lastError] ?? a.lastError : null;
          return {
            id: `automation-${a.id}`,
            clientId: a.clientId,
            text: `${getClientNameForAutomation(a.clientId)} · ${name} — requiere atención${errorEs ? ` · ${errorEs}` : ''}.`,
            href: '/automations',
          };
        }),
    [automations],
  );

  const attentionIntegrations: AttentionItem[] = useMemo(() => {
    const internalConnections = connections.filter((c) => c.scope === 'internal');
    return clients
      .map((client): AttentionItem | null => {
        const requirements = requirementsByClient[client.id] ?? [];
        const relevant = [...connections.filter((c) => c.clientId === client.id), ...internalConnections];
        const summary = summarizeClientOnboarding(client.id, requirements, relevant);
        const gaps = summary.requiredPending + summary.requiredIncomplete;
        if (gaps === 0) return null;
        return {
          id: `integration-${client.id}`,
          clientId: client.id,
          text: `${client.name}: ${gaps} integración${gaps === 1 ? '' : 'es'} requerida${gaps === 1 ? '' : 's'} sin configurar`,
          href: `/clients/${client.id}`,
        };
      })
      .filter((item): item is AttentionItem => item != null);
  }, [clients, connections, requirementsByClient]);

  const attentionAgents: AttentionItem[] = useMemo(
    () =>
      agents
        .filter((a) => getAiAgentConfigurationStatus(a) === 'incomplete')
        .map((a) => ({
          id: `agent-${a.id}`,
          clientId: a.clientId,
          text: `Agente IA "${a.name}" (${getClientNameForAiAgent(a.clientId)}) tiene configuración incompleta`,
          href: '/ai-agents',
        })),
    [agents],
  );

  const attentionContent: AttentionItem[] = useMemo(
    () =>
      contentItems
        .filter((item) => item.scope === 'internal' && isContentOverdue(item))
        .map((item) => ({
          id: `content-${item.id}`,
          text: `Contenido interno "${item.title}" lleva retraso (previsto ${item.plannedPublishDate})`,
          href: '/content',
        })),
    [contentItems],
  );

  const attentionItems: AttentionItem[] = [
    ...attentionAutomations,
    ...attentionIntegrations,
    ...attentionAgents,
    ...attentionContent,
  ];

  // "Estado operativo" — honestly derived, not a new metric: a client is
  // flagged the moment one of its own automations/integrations/agents is
  // already surfaced above in Necesita atención. No severity invented here.
  const clientsNeedingAttention = useMemo(() => {
    const ids = new Set<string>();
    for (const item of [...attentionAutomations, ...attentionIntegrations, ...attentionAgents]) {
      if (item.clientId) ids.add(item.clientId);
    }
    return ids;
  }, [attentionAutomations, attentionIntegrations, attentionAgents]);

  // ── Client snapshot — fast navigation + business awareness, not a second
  // Client Workspace. Counts reuse the exact same filters those pages use. ──
  const clientSnapshot = useMemo(
    () =>
      clients.map((client) => ({
        client,
        leadCount: leads.filter((l) => l.clientId === client.id).length,
        activeCampaignCount: campaigns.filter((c) => c.clientId === client.id && c.status === 'active').length,
        needsAttention: clientsNeedingAttention.has(client.id),
      })),
    [clients, leads, campaigns, clientsNeedingAttention],
  );

  // ── Quick access — the 4 highest-frequency REKREATIVE routes, derived
  // from the same nav source as the sidebar (lib/nav.ts) so labels/icons can
  // never drift from it or resurface a legacy FounderOS route. ──
  const QUICK_ACCESS_HREFS = ['/clients', '/leads', '/meta-ads', '/results'];
  const quickAccess = REKREATIVE_PRIMARY.filter((item) => QUICK_ACCESS_HREFS.includes(item.href));

  return (
    <div>
      <PageHeader eyebrow="REKREATIVE OS" title="Centro de operaciones" caret right={<Kbd>⌘K</Kbd>} />

      {/* Executive summary */}
      <section className="mb-[22px] grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile href="/clients" label="Clientes activos" value={activeClients} unit={`/ ${clients.length} total`} />
        <StatTile href="/leads" label="Leads CRM" value={leads.length} unit="en pipeline" />
        <StatTile href="/meta-ads" label="Campañas activas" value={activeCampaigns} unit={`/ ${campaigns.length} total`} />
        <StatTile href="/automations" label="Automatizaciones" value={automationsSummary.needsAttention} unit="requieren atención" />
        <StatTile href="/results" label="Ingresos atribuidos" value={formatEURDisplay(attributedRevenue)} unit="histórico" />
      </section>

      {/* Needs attention */}
      <section className="mb-[22px]">
        <SectionHead label="Necesita atención" count={attentionItems.length} />
        {attentionItems.length === 0 ? (
          <div className="rounded-lg-t border border-dashed border-os-border bg-os-surface2 px-4 py-6 text-center font-mono text-[11px] text-os-dim">
            Nada requiere atención ahora mismo.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {attentionItems.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="hoverable flex items-center gap-3 rounded-lg-t border border-os-border bg-os-surface px-3.5 py-[10px]"
              >
                <Dot state="warn" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-os-muted">{item.text}</span>
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-os-dim" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Client snapshot — a compact operational row per client, columns
          fixed so it reads densely on ultrawide instead of stretching into
          whitespace. Estado operativo is the only extra field, and it's
          just "does this client already appear in Necesita atención". */}
      <section className="mb-[22px]">
        <SectionHead label="Clientes" count={clients.length} link="Ver todos" href="/clients" />
        <div className="overflow-x-auto">
          <div className="flex min-w-[820px] flex-col gap-1.5">
            <div className="grid grid-cols-[1.6fr_0.8fr_1.3fr_0.55fr_0.9fr_0.9fr] gap-3 px-3.5 font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">
              <span>Cliente</span>
              <span>Estado</span>
              <span>Servicio</span>
              <span>Leads</span>
              <span>Campañas</span>
              <span>Operativo</span>
            </div>
            {clientSnapshot.map(({ client, leadCount, activeCampaignCount, needsAttention }) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="hoverable grid grid-cols-[1.6fr_0.8fr_1.3fr_0.55fr_0.9fr_0.9fr] items-center gap-3 rounded-lg-t border border-os-border bg-os-surface px-3.5 py-[10px]"
              >
                <span className="truncate text-[13px] font-semibold text-os-text">{client.name}</span>
                <span>
                  <Badge tone={client.status === 'active' ? 'ok' : 'default'}>{getClientStatusLabel(client.status)}</Badge>
                </span>
                <span className="truncate font-mono text-[10.5px] text-os-dim">{client.service}</span>
                <span className="font-mono text-[11px] text-os-muted">{leadCount}</span>
                <span className="font-mono text-[11px] text-os-muted">{activeCampaignCount}</span>
                <span className="flex items-center gap-1.5">
                  <Dot state={needsAttention ? 'warn' : 'ok'} />
                  <span className="font-mono text-[10px] uppercase tracking-wide text-os-dim">
                    {needsAttention ? 'Atención' : 'Operativo'}
                  </span>
                </span>
              </Link>
            ))}
            {clients.length === 0 && (
              <div className="rounded-lg-t border border-dashed border-os-border bg-os-surface2 px-4 py-6 text-center font-mono text-[11px] text-os-dim">
                Aún no hay clientes.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Quick access — 4 highest-frequency routes only; the rest of
          REKREATIVE_PRIMARY already lives in the sidebar. */}
      <section>
        <SectionHead label="Acceso rápido" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {quickAccess.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="hoverable flex items-center gap-2.5 rounded-lg-t border border-os-border bg-os-surface px-3.5 py-3"
            >
              <Icon className="h-[15px] w-[15px] shrink-0 text-os-dim" strokeWidth={1.7} />
              <span className="truncate text-[12.5px] font-semibold text-os-text">{label}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

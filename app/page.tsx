'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Dot, Kbd, Label, SectionHead } from '@/components/terminal';
import { REKREATIVE_PRIMARY } from '@/lib/nav';
import { getClientStatusLabel } from '@/lib/clients';
import { getClientNameForLead, getStageLabel, type LeadEvent, type LeadStage } from '@/lib/leads';
import { useClientsRegistry } from '@/components/ClientsProvider';
import { getLeads, type Lead } from '@/lib/api/leads';
import {
  getResultsHomeSnapshot,
  type ClientOperationalSnapshot,
  type ResultsHomeResponse,
} from '@/lib/api/results';
import { formatEUR } from '@/lib/results';
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

// REKREATIVE OS internal command center — "what's happening right now" and
// "what needs my attention". Clients, Leads, and every Results-derived
// number (high-priority/awaiting-contact leads, upcoming appointments,
// recent conversions/activity, value generated, per-client snapshot) are
// real PostgreSQL (lib/server/results-repo.ts via GET /api/results/home).
// Campaigns/Automations/AI Agents/Integrations/Content stay the existing
// localStorage demo stores — unchanged this pass, now explicitly marked
// DEMO on their tiles so real and demo data are never visually ambiguous.

type AttentionItem = {
  id: string;
  text: string;
  href: string;
  clientId?: string | null;
  /** True for the four still-localStorage sources (Automations/Integrations/
   * AI Agents/Content) — tags the row DEMO and excludes it from the header's
   * real-attention count (see realAttentionCount below). Real, PostgreSQL
   * items (high-priority/awaiting-contact leads) omit this. */
  demo?: boolean;
};

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

// Home-only presentation translation for the "Actividad reciente" feed —
// event-type-aware Spanish labels. Never mutates the stored LeadEvent
// (summary stays whatever lib/server/leads-repo.ts wrote); this only decides
// what text renders for it. manual_note keeps the operator's own note as-is.
function translateActivitySummary(event: LeadEvent): string {
  switch (event.type) {
    case 'stage_changed': {
      const to = (event.details as { to?: string } | null | undefined)?.to;
      return to ? `Etapa cambiada a ${getStageLabel(to as LeadStage)}` : event.summary;
    }
    case 'converted':
      return 'Lead convertido';
    case 'disqualified':
      return 'Lead descartado';
    case 'appointment_completed':
      return 'Cita completada';
    case 'appointment_booked':
      return 'Cita reservada';
    case 'whatsapp_sent':
      return 'WhatsApp enviado';
    case 'whatsapp_delivered':
      return 'WhatsApp entregado';
    case 'lead_replied':
      return 'Lead respondió';
    case 'commercial_contacted':
      return 'Contacto comercial registrado';
    case 'ai_analyzed':
      return 'Analizado por IA';
    case 'lead_received':
      return 'Lead recibido';
    case 'manual_note':
      return event.summary;
    default:
      return event.summary;
  }
}

function formatDateShort(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function StatTile({
  href,
  label,
  value,
  unit,
  demo = false,
}: {
  href: string;
  label: string;
  value: React.ReactNode;
  unit: string;
  /** Marks a tile as sourced from a localStorage demo store, never a live
   * PostgreSQL number — see the Home Demo Data Policy in the project docs. */
  demo?: boolean;
}) {
  return (
    <Link
      href={href}
      className="hoverable group flex flex-col gap-2 rounded-lg-t border border-os-border bg-os-surface px-[18px] py-4"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-os-dim">
          {label}
          {demo && (
            <span className="rounded-sm-t border border-os-border px-1 py-[1px] text-[8px] font-bold tracking-[0.1em] text-os-dim">
              DEMO
            </span>
          )}
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 text-os-dim opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="flex items-baseline gap-[7px] font-mono text-[26px] font-semibold tracking-[-0.02em] text-os-text">
        {value}
        <small className="whitespace-nowrap text-xs font-normal text-os-dim">{unit}</small>
      </div>
    </Link>
  );
}

function ActivityRow({
  href,
  state,
  text,
  demo = false,
}: {
  href: string;
  state: 'ok' | 'warn';
  text: string;
  /** Same DEMO tag as StatTile — marks a row sourced from a localStorage
   * demo store rather than live PostgreSQL. */
  demo?: boolean;
}) {
  return (
    <Link href={href} className="hoverable flex items-center gap-3 rounded-lg-t border border-os-border bg-os-surface px-3.5 py-[10px]">
      <Dot state={state} />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-os-muted">{text}</span>
      {demo && (
        <span className="shrink-0 rounded-sm-t border border-os-border px-1 py-[1px] text-[8px] font-bold uppercase tracking-[0.1em] text-os-dim">
          DEMO
        </span>
      )}
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-os-dim" />
    </Link>
  );
}

export default function HomePage() {
  // Canonical PostgreSQL registry — same source /clients and /leads read.
  const { clients, error: clientsError } = useClientsRegistry();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [homeSnapshot, setHomeSnapshot] = useState<ResultsHomeResponse | null>(null);
  const [homeSnapshotError, setHomeSnapshotError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [attentionExpanded, setAttentionExpanded] = useState(true);

  // Leads (total count) + the real operational snapshot: both PostgreSQL,
  // async, cancellation-guarded.
  useEffect(() => {
    let cancelled = false;
    getLeads()
      .then((result) => {
        if (!cancelled) setLeads(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLeadsError(error instanceof Error ? error.message : 'No se pudieron cargar los leads.');
      });
    getResultsHomeSnapshot()
      .then((result) => {
        if (!cancelled) setHomeSnapshot(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setHomeSnapshotError(error instanceof Error ? error.message : 'No se pudo cargar la actividad operativa.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Everything else stays localStorage in this pass — unchanged, synchronous.
  useEffect(() => {
    initializeMetaCampaignsStoreIfNeeded();
    initializeAutomationsStoreIfNeeded();
    initializeAiAgentsStoreIfNeeded();
    initializeIntegrationConnectionsStoreIfNeeded();
    initializeClientIntegrationRequirementsStoreIfNeeded();
    initializeContentStoreIfNeeded();

    setCampaigns(getCampaigns());
    setAutomations(getAutomations());
    setAgents(getAiAgents());
    setConnections(getIntegrationConnections());
    setContentItems(getContentItems());
  }, []);

  // Derived from the canonical `clients` list — recomputes whenever it
  // changes (e.g. once the registry's fetch resolves), unlike the old
  // one-time-on-mount version of this map.
  const requirementsByClient = useMemo(() => {
    const map: Record<string, ClientIntegrationRequirement[]> = {};
    for (const client of clients) map[client.id] = getClientIntegrationRequirements(client.id);
    return map;
  }, [clients]);

  const clientSnapshotByClientId = useMemo(() => {
    const map = new Map<string, ClientOperationalSnapshot>();
    for (const row of homeSnapshot?.clientSnapshot ?? []) map.set(row.clientId, row);
    return map;
  }, [homeSnapshot]);

  // ── Executive summary — honest counts only, no invented periods/rates ──
  const activeClients = clients.filter((c) => c.status === 'active').length;
  const activeCampaigns = campaigns.filter((c) => c.status === 'active').length;
  const automationsSummary = useMemo(() => summarizeAutomations(automations), [automations]);
  const valueGeneratedRecently = homeSnapshot?.valueGenerated ?? null;

  // ── Needs attention — deterministic state only, no fake AI insights or
  // invented severity scores. Every source is an existing derivation, plus
  // (real, PostgreSQL) high-priority/awaiting-first-contact leads. ──
  const attentionHighPriorityLeads: AttentionItem[] = useMemo(
    () =>
      (homeSnapshot?.highPriorityLeads ?? []).map((lead) => ({
        id: `lead-priority-${lead.id}`,
        clientId: lead.clientId,
        text: `${getClientNameForLead(lead.clientId, clients)} · ${lead.name} — prioridad alta, requiere seguimiento.`,
        href: '/leads',
      })),
    [homeSnapshot, clients],
  );

  const attentionAwaitingContact: AttentionItem[] = useMemo(
    () =>
      (homeSnapshot?.awaitingFirstContact ?? []).map((lead) => ({
        id: `lead-awaiting-${lead.id}`,
        clientId: lead.clientId,
        text: `${getClientNameForLead(lead.clientId, clients)} · ${lead.name} — sin primer contacto (WhatsApp no enviado).`,
        href: '/leads',
      })),
    [homeSnapshot, clients],
  );

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
            text: `${getClientNameForAutomation(a.clientId, clients)} · ${name} — requiere atención${errorEs ? ` · ${errorEs}` : ''}.`,
            href: '/automations',
            demo: true,
          };
        }),
    [automations, clients],
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
          demo: true,
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
          text: `Agente IA "${a.name}" (${getClientNameForAiAgent(a.clientId, clients)}) tiene configuración incompleta`,
          href: '/ai-agents',
          demo: true,
        })),
    [agents, clients],
  );

  const attentionContent: AttentionItem[] = useMemo(
    () =>
      contentItems
        .filter((item) => item.scope === 'internal' && isContentOverdue(item))
        .map((item) => ({
          id: `content-${item.id}`,
          text: `Contenido interno "${item.title}" lleva retraso (previsto ${item.plannedPublishDate})`,
          href: '/content',
          demo: true,
        })),
    [contentItems],
  );

  const attentionItems: AttentionItem[] = [
    ...attentionHighPriorityLeads,
    ...attentionAwaitingContact,
    ...attentionAutomations,
    ...attentionIntegrations,
    ...attentionAgents,
    ...attentionContent,
  ];

  // The header count reflects REAL (PostgreSQL) attention items only —
  // demo-sourced rows (tagged `demo: true` above) stay visible in the list
  // but never inflate this number.
  const realAttentionCount = attentionHighPriorityLeads.length + attentionAwaitingContact.length;

  // "Estado operativo" — honestly derived, not a new metric: a client is
  // flagged the moment one of its own leads/automations/integrations/agents
  // is already surfaced above in Necesita atención. No severity invented here.
  const clientsNeedingAttention = useMemo(() => {
    const ids = new Set<string>();
    for (const item of [...attentionHighPriorityLeads, ...attentionAwaitingContact, ...attentionAutomations, ...attentionIntegrations, ...attentionAgents]) {
      if (item.clientId) ids.add(item.clientId);
    }
    return ids;
  }, [attentionHighPriorityLeads, attentionAwaitingContact, attentionAutomations, attentionIntegrations, attentionAgents]);

  // ── Upcoming appointments / recent conversions / recent activity — real,
  // event-time (not acquisition-cohort) operational feeds. ──
  const upcomingAppointments = homeSnapshot?.upcomingAppointments ?? [];
  const recentConversions = homeSnapshot?.recentConversions ?? [];
  const recentActivity = homeSnapshot?.recentActivity ?? [];

  // ── Client snapshot — fast navigation + business awareness, not a second
  // Client Workspace. Leads/Citas/Conversiones/Valor generado all come from
  // the same real per-client snapshot the executive summary above uses. ──
  const clientSnapshot = useMemo(
    () =>
      clients.map((client) => {
        const row = clientSnapshotByClientId.get(client.id);
        return {
          client,
          leadCount: row?.leads ?? 0,
          appointments: row?.appointments ?? 0,
          conversions: row?.conversions ?? 0,
          valueGenerated: row?.valueGenerated ?? null,
          needsAttention: clientsNeedingAttention.has(client.id),
        };
      }),
    [clients, clientSnapshotByClientId, clientsNeedingAttention],
  );

  // ── Quick access — the 4 highest-frequency REKREATIVE routes, derived
  // from the same nav source as the sidebar (lib/nav.ts) so labels/icons can
  // never drift from it or resurface a legacy FounderOS route. ──
  const QUICK_ACCESS_HREFS = ['/clients', '/leads', '/meta-ads', '/results'];
  const quickAccess = REKREATIVE_PRIMARY.filter((item) => QUICK_ACCESS_HREFS.includes(item.href));

  return (
    <div>
      <PageHeader eyebrow="REKREATIVE OS" title="Centro de operaciones" caret right={<Kbd>⌘K</Kbd>} />

      {(clientsError || leadsError || homeSnapshotError) && (
        <div className="mb-[22px] border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">
          {clientsError ?? leadsError ?? homeSnapshotError}
        </div>
      )}

      {/* Executive summary */}
      <section className="mb-[22px] grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile href="/clients" label="Clientes activos" value={activeClients} unit={`/ ${clients.length} total`} />
        <StatTile href="/leads" label="Leads CRM" value={leads.length} unit="total" />
        <StatTile href="/meta-ads" label="Campañas activas" value={activeCampaigns} unit={`/ ${campaigns.length} total`} demo />
        <StatTile href="/automations" label="Automatizaciones" value={automationsSummary.needsAttention} unit="requieren atención" demo />
        <StatTile
          href="/results"
          label="Valor generado"
          value={valueGeneratedRecently?.total == null ? '—' : formatEUR(valueGeneratedRecently.total)}
          unit={`últimos ${valueGeneratedRecently?.days ?? 7} días`}
        />
      </section>

      {/* Needs attention — header/count always visible; collapsing only
          hides the rows below. Count is REAL (PostgreSQL) attention items
          only (high-priority/awaiting-contact leads) — demo-sourced rows
          (Automations/Integrations/AI Agents/Content) stay in the list,
          each tagged DEMO, but never inflate this number. */}
      <section className="mb-[22px]">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Label count={realAttentionCount} rule>
              Necesita atención
            </Label>
          </div>
          <button
            type="button"
            onClick={() => setAttentionExpanded((expanded) => !expanded)}
            aria-expanded={attentionExpanded}
            className="shrink-0 font-mono text-[11px] text-os-dim transition-colors hover:text-os-accent"
          >
            {attentionExpanded ? 'Colapsar ▲' : 'Expandir ▼'}
          </button>
        </div>
        {attentionExpanded &&
          (attentionItems.length === 0 ? (
            <div className="rounded-lg-t border border-dashed border-os-border bg-os-surface2 px-4 py-6 text-center font-mono text-[11px] text-os-dim">
              Nada requiere atención ahora mismo.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {attentionItems.map((item) => (
                <ActivityRow key={item.id} href={item.href} state="warn" text={item.text} demo={item.demo} />
              ))}
            </div>
          ))}
      </section>

      {/* Upcoming appointments + recent activity — real, event-time feeds.
          Two compact columns on wide screens, stacked on narrow ones; same
          row visual as "Necesita atención" but neutral (ok) state, since
          these are informational, not problems. */}
      <section className="mb-[22px] grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <SectionHead label="Próximas citas" count={upcomingAppointments.length} />
          {upcomingAppointments.length === 0 ? (
            <div className="rounded-lg-t border border-dashed border-os-border bg-os-surface2 px-4 py-6 text-center font-mono text-[11px] text-os-dim">
              Sin citas próximas.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {upcomingAppointments.map((lead) => (
                <ActivityRow
                  key={lead.id}
                  href="/leads"
                  state="ok"
                  text={`${getClientNameForLead(lead.clientId, clients)} · ${lead.name} — cita ${formatDateShort(lead.appointmentDate)}`}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <SectionHead label="Actividad reciente" count={recentActivity.length} />
          {recentActivity.length === 0 ? (
            <div className="rounded-lg-t border border-dashed border-os-border bg-os-surface2 px-4 py-6 text-center font-mono text-[11px] text-os-dim">
              Sin actividad todavía.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {recentActivity.map((entry) => (
                <ActivityRow key={entry.event.id} href="/leads" state="ok" text={translateActivitySummary(entry.event)} />
              ))}
            </div>
          )}
        </div>
      </section>

      {recentConversions.length > 0 && (
        <section className="mb-[22px]">
          <SectionHead label="Conversiones recientes" count={recentConversions.length} />
          <div className="flex flex-col gap-1.5">
            {recentConversions.map(({ lead, convertedAt }) => (
              <ActivityRow
                key={lead.id}
                href="/leads"
                state="ok"
                text={`${getClientNameForLead(lead.clientId, clients)} · ${lead.name} — convertido ${formatDateShort(convertedAt)}${
                  lead.conversionValue != null ? ` · ${formatEUR(lead.conversionValue)}` : ''
                }`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Client snapshot — a compact operational row per client, columns
          fixed so it reads densely on ultrawide instead of stretching into
          whitespace. Leads/Citas/Conversiones/Valor generado are real
          (lib/server/results-repo.ts); Estado operativo is just "does this
          client already appear in Necesita atención". */}
      <section className="mb-[22px]">
        <SectionHead label="Clientes" count={clients.length} link="Ver todos" href="/clients" />
        <div className="overflow-x-auto">
          <div className="flex min-w-[920px] flex-col gap-1.5">
            <div className="grid grid-cols-[1.6fr_0.7fr_0.55fr_0.55fr_0.75fr_0.9fr_0.9fr] gap-3 px-3.5 font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">
              <span>Cliente</span>
              <span>Estado</span>
              <span>Leads</span>
              <span>Citas</span>
              <span>Conversiones</span>
              <span>Valor generado</span>
              <span>Operativo</span>
            </div>
            {clientSnapshot.map(({ client, leadCount, appointments, conversions, valueGenerated, needsAttention }) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="hoverable grid grid-cols-[1.6fr_0.7fr_0.55fr_0.55fr_0.75fr_0.9fr_0.9fr] items-center gap-3 rounded-lg-t border border-os-border bg-os-surface px-3.5 py-[10px]"
              >
                <span className="truncate text-[13px] font-semibold text-os-text">{client.name}</span>
                <span>
                  <Badge tone={client.status === 'active' ? 'ok' : 'default'}>{getClientStatusLabel(client.status)}</Badge>
                </span>
                <span className="font-mono text-[11px] text-os-muted">{leadCount}</span>
                <span className="font-mono text-[11px] text-os-muted">{appointments}</span>
                <span className="font-mono text-[11px] text-os-muted">{conversions}</span>
                <span className="font-mono text-[11px] text-os-muted">{valueGenerated == null ? '—' : formatEUR(valueGenerated)}</span>
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

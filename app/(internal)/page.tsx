'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, CalendarDays, CircleDollarSign, Megaphone, Target, Users, type LucideIcon } from 'lucide-react';
import { useClientsRegistry } from '@/components/ClientsProvider';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Dot, Kbd, SectionHead } from '@/components/terminal';
import { getMetaAdsCampaigns } from '@/lib/api/meta-ads';
import { getLeads, type Lead } from '@/lib/api/leads';
import { getOpsSnapshot as fetchOpsSnapshot } from '@/lib/api/ops-status';
import { getResultsHomeSnapshot, type ClientOperationalSnapshot, type ResultsHomeResponse } from '@/lib/api/results';
import { getClientStatusLabel } from '@/lib/clients';
import { getClientNameForLead, getStageLabel, type LeadEvent, type LeadStage } from '@/lib/leads';
import type { OpsSnapshot } from '@/lib/ops-status';
import { formatEUR } from '@/lib/results';

type AttentionItem = {
  id: string;
  title: string;
  detail: string;
  href: string;
  clientId?: string | null;
  priority: 'critica' | 'alta' | 'media';
};

function translateActivitySummary(event: LeadEvent): string {
  switch (event.type) {
    case 'stage_changed': {
      const to = (event.details as { to?: string } | null | undefined)?.to;
      return to ? `Etapa cambiada a ${getStageLabel(to as LeadStage)}` : event.summary;
    }
    case 'converted': return 'Lead convertido';
    case 'disqualified': return 'Lead descartado';
    case 'appointment_completed': return 'Cita completada';
    case 'appointment_booked': return 'Cita reservada';
    case 'whatsapp_sent': return 'WhatsApp enviado';
    case 'whatsapp_delivered': return 'WhatsApp entregado';
    case 'lead_replied': return 'Lead respondió';
    case 'commercial_contacted': return 'Contacto comercial registrado';
    case 'ai_analyzed': return 'Analizado por IA';
    case 'lead_received': return 'Lead recibido';
    default: return event.summary;
  }
}

function formatDateShort(value: string | null): string {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function StatTile({ href, label, value, unit, icon: Icon }: {
  href: string; label: string; value: ReactNode; unit: string; icon: LucideIcon;
}) {
  return (
    <Link href={href} className="hoverable group min-w-0 border border-os-border bg-os-surface px-4 py-4 sm:px-[18px]">
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-os-dim sm:text-[10px]">{label}</span>
        <span className="grid h-8 w-8 shrink-0 place-items-center border border-os-border text-os-dim">
          <Icon className="h-4 w-4" strokeWidth={1.6} />
        </span>
      </div>
      <div className="mt-3 flex min-w-0 items-baseline gap-2 font-mono text-[24px] font-semibold tracking-[-0.03em] text-os-text sm:text-[27px]">
        <span className="truncate">{value}</span>
        <small className="truncate text-[10px] font-normal text-os-dim sm:text-[11px]">{unit}</small>
      </div>
    </Link>
  );
}

function PriorityRow({ item, compact = false }: { item: AttentionItem; compact?: boolean }) {
  const tone = item.priority === 'critica' ? 'err' : 'warn';
  return (
    <Link href={item.href} className="hoverable group flex min-w-0 items-center gap-3 border border-os-border bg-os-surface px-3.5 py-3">
      <Dot state={tone} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-semibold text-os-text sm:text-[12.5px]">{item.title}</span>
          {!compact && <Badge tone={tone}>{item.priority}</Badge>}
        </div>
        <p className="mt-1 truncate font-mono text-[10px] text-os-dim">{item.detail}</p>
      </div>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-os-dim transition-colors group-hover:text-os-accent" />
    </Link>
  );
}

function FeedRow({ href, title, detail }: { href: string; title: string; detail?: string }) {
  return (
    <Link href={href} className="hoverable flex min-w-0 items-center gap-3 border border-os-border bg-os-surface px-3.5 py-3">
      <Dot state="ok" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] text-os-muted">{title}</p>
        {detail && <p className="mt-1 truncate font-mono text-[10px] text-os-dim">{detail}</p>}
      </div>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-os-dim" />
    </Link>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="border border-dashed border-os-border bg-os-surface2 px-4 py-7 text-center font-mono text-[10.5px] text-os-dim">{children}</div>;
}

function FunnelStep({ label, value, detail, last = false }: { label: string; value: number; detail: string; last?: boolean }) {
  return (
    <div className="relative min-w-0 border border-os-border bg-os-surface px-4 py-4 sm:border-r-0 sm:last:border-r">
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-os-dim">{label}</p>
      <p className="mt-2 font-mono text-[25px] font-semibold text-os-text">{value}</p>
      <p className="mt-1 font-mono text-[10px] text-os-dim">{detail}</p>
      {!last && <ArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 bg-os-bg p-1 text-os-dim sm:block" />}
    </div>
  );
}

export default function HomePage() {
  const { clients, error: clientsError } = useClientsRegistry();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsError, setLeadsError] = useState<string | null>(null);
  const [homeSnapshot, setHomeSnapshot] = useState<ResultsHomeResponse | null>(null);
  const [homeSnapshotError, setHomeSnapshotError] = useState<string | null>(null);
  const [metaAdsCampaignCounts, setMetaAdsCampaignCounts] = useState({ active: 0, total: 0 });
  const [opsSnapshot, setOpsSnapshot] = useState<OpsSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getLeads(), getResultsHomeSnapshot(), fetchOpsSnapshot()]).then((results) => {
      if (cancelled) return;
      const [leadResult, homeResult, opsResult] = results;
      if (leadResult.status === 'fulfilled') setLeads(leadResult.value);
      else setLeadsError('No se pudieron cargar los leads.');
      if (homeResult.status === 'fulfilled') setHomeSnapshot(homeResult.value);
      else setHomeSnapshotError('No se pudo cargar la actividad operativa.');
      if (opsResult.status === 'fulfilled') setOpsSnapshot(opsResult.value);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getMetaAdsCampaigns({ preset: 'all' })
      .then((response) => {
        if (cancelled) return;
        setMetaAdsCampaignCounts({
          active: response.campaigns.filter((campaign) => campaign.status === 'active').length,
          total: response.campaigns.length,
        });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const clientSnapshotByClientId = useMemo(() => {
    const map = new Map<string, ClientOperationalSnapshot>();
    for (const row of homeSnapshot?.clientSnapshot ?? []) map.set(row.clientId, row);
    return map;
  }, [homeSnapshot]);

  const highPriorityItems: AttentionItem[] = useMemo(() =>
    (homeSnapshot?.highPriorityLeads ?? []).map((lead) => ({
      id: `priority-${lead.id}`,
      title: `${getClientNameForLead(lead.clientId, clients)}: ${lead.name}`,
      detail: 'Lead de prioridad alta que requiere seguimiento',
      href: '/leads', clientId: lead.clientId, priority: 'alta',
    })), [homeSnapshot, clients]);

  const awaitingContactItems: AttentionItem[] = useMemo(() =>
    (homeSnapshot?.awaitingFirstContact ?? []).map((lead) => ({
      id: `contact-${lead.id}`,
      title: `${getClientNameForLead(lead.clientId, clients)}: ${lead.name}`,
      detail: 'Pendiente de primer contacto comercial',
      href: '/leads', clientId: lead.clientId, priority: 'media',
    })), [homeSnapshot, clients]);

  const opsItems: AttentionItem[] = useMemo(() =>
    (opsSnapshot?.attention ?? []).map((item) => ({
      id: `ops-${item.id}`, title: item.text, detail: 'Revisión de configuración operativa',
      href: '/connections', priority: 'critica',
    })), [opsSnapshot]);

  const attentionItems = [...opsItems, ...highPriorityItems, ...awaitingContactItems];
  const topPriorities = attentionItems.slice(0, 3);
  const clientsNeedingAttention = useMemo(() =>
    new Set([...highPriorityItems, ...awaitingContactItems].flatMap((item) => item.clientId ? [item.clientId] : [])),
  [highPriorityItems, awaitingContactItems]);

  const activeClients = clients.filter((client) => client.status === 'active').length;
  const contactedLeads = leads.filter((lead) => lead.stage !== 'new').length;
  const appointmentLeads = leads.filter((lead) => lead.stage === 'appointment' || lead.stage === 'converted').length;
  const convertedLeads = leads.filter((lead) => lead.stage === 'converted').length;
  const funnelRate = leads.length > 0 ? Math.round((convertedLeads / leads.length) * 100) : 0;
  const upcomingAppointments = homeSnapshot?.upcomingAppointments ?? [];
  const recentActivity = homeSnapshot?.recentActivity ?? [];
  const valueGenerated = homeSnapshot?.valueGenerated ?? null;
  const operationalAutomations = opsSnapshot?.automations.filter((item) =>
    item.status === 'operational' || item.status === 'activity_observed').length ?? 0;

  const clientSnapshot = useMemo(() => clients.map((client) => {
    const row = clientSnapshotByClientId.get(client.id);
    return {
      client, leads: row?.leads ?? 0, appointments: row?.appointments ?? 0,
      conversions: row?.conversions ?? 0, valueGenerated: row?.valueGenerated ?? null,
      needsAttention: clientsNeedingAttention.has(client.id),
    };
  }), [clients, clientSnapshotByClientId, clientsNeedingAttention]);

  const error = clientsError ?? leadsError ?? homeSnapshotError;

  return (
    <div>
      <PageHeader eyebrow="REKREATIVE OS / INICIO" title="Bienvenido, Kilian" right={<Kbd>⌘K</Kbd>} />
      {error && <div className="mb-5 border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">{error}</div>}

      <section aria-label="Resumen ejecutivo" className="mb-5 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
        <StatTile href="/clients" label="Clientes activos" value={activeClients} unit={`/ ${clients.length}`} icon={Users} />
        <StatTile href="/leads" label="Leads CRM" value={leads.length} unit="totales" icon={Target} />
        <StatTile href="/leads" label="Próximas citas" value={upcomingAppointments.length} unit="agenda" icon={CalendarDays} />
        <StatTile href="/results" label="Conversiones" value={convertedLeads} unit={`${funnelRate}% cierre`} icon={ArrowUpRight} />
        <StatTile href="/results" label="Valor generado" value={valueGenerated?.total == null ? 'Sin datos' : formatEUR(valueGenerated.total)} unit={`${valueGenerated?.days ?? 7} días`} icon={CircleDollarSign} />
      </section>

      <section className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_0.75fr]">
        <div>
          <SectionHead label="Funnel comercial" link="Ver resultados" href="/results" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:gap-0">
            <FunnelStep label="Leads" value={leads.length} detail="Entrada total" />
            <FunnelStep label="Contactados" value={contactedLeads} detail="Con actividad" />
            <FunnelStep label="Citas" value={appointmentLeads} detail="Reservadas o cerradas" />
            <FunnelStep label="Cierres" value={convertedLeads} detail={`${funnelRate}% del total`} last />
          </div>
        </div>
        <div>
          <SectionHead label="Prioridades de hoy" count={attentionItems.length} />
          <div className="flex flex-col gap-1.5">
            {topPriorities.length === 0 ? <EmptyState>No hay prioridades críticas ahora mismo.</EmptyState> : topPriorities.map((item) => <PriorityRow key={item.id} item={item} compact />)}
          </div>
        </div>
      </section>

      <section className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_0.75fr]">
        <div>
          <SectionHead label="Cartera de clientes" count={clients.length} link="Ver todos" href="/clients" />
          <div className="flex flex-col gap-2 lg:hidden">
            {clientSnapshot.map(({ client, leads: leadCount, appointments, conversions, valueGenerated: clientValue, needsAttention }) => (
              <Link key={client.id} href={`/clients/${client.id}`} className="hoverable border border-os-border bg-os-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-[13px] font-semibold text-os-text">{client.name}</p><p className="mt-1 font-mono text-[9px] uppercase tracking-[0.15em] text-os-dim">{getClientStatusLabel(client.status)}</p></div>
                  <Badge tone={needsAttention ? 'warn' : 'ok'}>{needsAttention ? 'Atención' : 'Operativo'}</Badge>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2 border-t border-os-hairline pt-3">
                  {([['Leads', leadCount], ['Citas', appointments], ['Cierres', conversions], ['Valor', clientValue == null ? 'Sin datos' : formatEUR(clientValue)]] as const).map(([label, value]) => (
                    <div key={label} className="min-w-0"><p className="font-mono text-[8px] uppercase tracking-[0.12em] text-os-dim">{label}</p><p className="mt-1 truncate font-mono text-[11px] text-os-muted">{value}</p></div>
                  ))}
                </div>
              </Link>
            ))}
            {clients.length === 0 && <EmptyState>Aún no hay clientes.</EmptyState>}
          </div>

          <div className="hidden lg:block">
            <div className="overflow-x-auto">
              <div className="min-w-[820px]">
                <div className="grid grid-cols-[1.6fr_0.8fr_0.55fr_0.55fr_0.65fr_0.9fr_0.9fr] gap-3 px-3.5 py-2 font-mono text-[8.5px] uppercase tracking-[0.15em] text-os-dim">
                  <span>Cliente</span><span>Estado</span><span>Leads</span><span>Citas</span><span>Cierres</span><span>Valor</span><span>Salud</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {clientSnapshot.map(({ client, leads: leadCount, appointments, conversions, valueGenerated: clientValue, needsAttention }) => (
                    <Link key={client.id} href={`/clients/${client.id}`} className="hoverable grid grid-cols-[1.6fr_0.8fr_0.55fr_0.55fr_0.65fr_0.9fr_0.9fr] items-center gap-3 border border-os-border bg-os-surface px-3.5 py-3">
                      <span className="truncate text-[12.5px] font-semibold text-os-text">{client.name}</span>
                      <Badge tone={client.status === 'active' ? 'ok' : 'default'}>{getClientStatusLabel(client.status)}</Badge>
                      <span className="font-mono text-[10.5px] text-os-muted">{leadCount}</span><span className="font-mono text-[10.5px] text-os-muted">{appointments}</span><span className="font-mono text-[10.5px] text-os-muted">{conversions}</span>
                      <span className="font-mono text-[10.5px] text-os-muted">{clientValue == null ? 'Sin datos' : formatEUR(clientValue)}</span>
                      <span className="flex items-center gap-2 font-mono text-[9px] uppercase text-os-dim"><Dot state={needsAttention ? 'warn' : 'ok'} />{needsAttention ? 'Atención' : 'Operativo'}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
            {clients.length === 0 && <EmptyState>Aún no hay clientes.</EmptyState>}
          </div>
        </div>

        <div className="grid grid-cols-2 content-start gap-2.5">
          <Link href="/meta-ads" className="hoverable border border-os-border bg-os-surface p-4"><Megaphone className="h-4 w-4 text-os-dim" /><p className="mt-4 font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Meta Ads</p><p className="mt-2 font-mono text-[22px] font-semibold text-os-text">{metaAdsCampaignCounts.active}</p><p className="mt-1 font-mono text-[9px] text-os-dim">de {metaAdsCampaignCounts.total} activas</p></Link>
          <Link href="/automations" className="hoverable border border-os-border bg-os-surface p-4"><Target className="h-4 w-4 text-os-dim" /><p className="mt-4 font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Automatizaciones</p><p className="mt-2 font-mono text-[22px] font-semibold text-os-text">{operationalAutomations}</p><p className="mt-1 font-mono text-[9px] text-os-dim">con evidencia real</p></Link>
        </div>
      </section>

      <section className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <SectionHead label="Agenda operativa" count={upcomingAppointments.length + recentActivity.length} />
          <div className="flex flex-col gap-1.5">
            {upcomingAppointments.slice(0, 4).map((lead) => <FeedRow key={`appointment-${lead.id}`} href="/leads" title={`${lead.name}: cita ${formatDateShort(lead.appointmentDate)}`} detail={getClientNameForLead(lead.clientId, clients)} />)}
            {recentActivity.slice(0, Math.max(0, 5 - upcomingAppointments.length)).map((entry) => <FeedRow key={entry.event.id} href="/leads" title={translateActivitySummary(entry.event)} detail={`${getClientNameForLead(entry.leadClientId, clients)}: ${entry.leadName}`} />)}
            {upcomingAppointments.length === 0 && recentActivity.length === 0 && <EmptyState>Sin actividad pendiente o reciente.</EmptyState>}
          </div>
        </div>
        <div>
          <SectionHead label="Necesita atención" count={attentionItems.length} link="Revisar leads" href="/leads" />
          <div className="flex flex-col gap-1.5">
            {attentionItems.length === 0 ? <EmptyState>Todo está bajo control ahora mismo.</EmptyState> : attentionItems.slice(0, 7).map((item) => <PriorityRow key={item.id} item={item} />)}
          </div>
        </div>
      </section>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { getClientStatusLabel, type Client } from '@/lib/clients';
import { formatEUR } from '@/lib/results';
import type { AutomationsSummary } from '@/lib/automations';
import type { AiAgentsSummary } from '@/lib/agents-ai';
import type { ClientOnboardingSummary } from '@/lib/client-integration-requirements';

// Resumen tab — a compact operational snapshot, deliberately built ONLY from
// counts/summaries that already exist elsewhere (summarizeAutomations,
// summarizeAiAgents, summarizeClientOnboarding, sumAttributedRevenue). This
// component never derives a new rate/metric itself — it is purely
// presentational, receiving pre-computed summaries as props so the same
// business logic isn't duplicated between this tab and its full module.

export type ClientLeadCounts = { total: number; open: number };
export type ClientMetaAdsCounts = { total: number; active: number };

type ClientWorkspaceTab = 'meta-ads' | 'leads' | 'automations' | 'agents' | 'integrations';

function SummaryCard({
  title,
  onOpen,
  children,
}: {
  title: string;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between border border-os-border bg-os-surface p-3">
      <div>
        <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">{title}</div>
        <div className="mt-2 space-y-1.5">{children}</div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-3 self-start font-mono text-[9.5px] uppercase tracking-wide text-os-dim hover:text-os-accent"
      >
        Ver →
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[10.5px] text-os-dim">{label}</span>
      <span className="font-mono text-[13px] font-semibold text-os-text">{value}</span>
    </div>
  );
}

export function ClientOverviewPanel({
  client,
  leadCounts,
  metaAdsCounts,
  automationsSummary,
  agentsSummary,
  onboardingSummary,
  attributedRevenueAllTime,
  onOpenTab,
}: {
  client: Client;
  leadCounts: ClientLeadCounts;
  metaAdsCounts: ClientMetaAdsCounts;
  automationsSummary: AutomationsSummary;
  agentsSummary: AiAgentsSummary;
  onboardingSummary: ClientOnboardingSummary;
  attributedRevenueAllTime: number;
  onOpenTab: (tab: ClientWorkspaceTab) => void;
}) {
  return (
    <div>
      <h3 className="mb-4 text-lg font-semibold">Resumen</h3>

      {/* Client identity */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="p-3 border border-os-border bg-os-surface2">
          <div className="text-[11px] text-os-dim uppercase tracking-wide">Nombre</div>
          <div className="mt-2 font-semibold">{client.name}</div>
        </div>
        <div className="p-3 border border-os-border bg-os-surface2">
          <div className="text-[11px] text-os-dim uppercase tracking-wide">Estado</div>
          <div className="mt-2 font-mono">{getClientStatusLabel(client.status)}</div>
        </div>
        <div className="p-3 border border-os-border bg-os-surface2">
          <div className="text-[11px] text-os-dim uppercase tracking-wide">Sector</div>
          <div className="mt-2">{client.sector}</div>
        </div>
        <div className="p-3 border border-os-border bg-os-surface2">
          <div className="text-[11px] text-os-dim uppercase tracking-wide">Servicio</div>
          <div className="mt-2">{client.service}</div>
        </div>
      </div>

      {/* Operational summary — one card per module, honest counts only */}
      <div className="mt-6">
        <h4 className="text-sm font-semibold text-os-dim mb-3 uppercase tracking-wide">Resumen operativo</h4>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryCard title="Leads" onOpen={() => onOpenTab('leads')}>
            <Stat label="Total" value={String(leadCounts.total)} />
            <Stat label="Abiertos" value={String(leadCounts.open)} />
          </SummaryCard>

          <SummaryCard title="Meta Ads" onOpen={() => onOpenTab('meta-ads')}>
            <Stat label="Campañas activas" value={String(metaAdsCounts.active)} />
            <Stat label="Presupuesto contratado" value={formatEUR(client.metaBudgetMonthly)} />
          </SummaryCard>

          <SummaryCard title="Automatizaciones" onOpen={() => onOpenTab('automations')}>
            <Stat label="Activas" value={String(automationsSummary.active)} />
            <Stat label="Requieren atención" value={String(automationsSummary.needsAttention)} />
          </SummaryCard>

          <SummaryCard title="Agentes IA" onOpen={() => onOpenTab('agents')}>
            <Stat label="Activos" value={String(agentsSummary.active)} />
            <Stat label="Configuración incompleta" value={String(agentsSummary.incompleteConfiguration)} />
          </SummaryCard>

          <SummaryCard title="Integraciones" onOpen={() => onOpenTab('integrations')}>
            <Stat
              label="Requeridas configuradas"
              value={`${onboardingSummary.requiredConfigured}/${onboardingSummary.requiredTotal}`}
            />
            <Stat
              label="Progreso"
              value={onboardingSummary.progressPercent == null ? '—' : `${onboardingSummary.progressPercent}%`}
            />
          </SummaryCard>

          <div className="flex flex-col justify-between border border-os-border bg-os-surface p-3">
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Resultados</div>
              <div className="mt-2 space-y-1.5">
                <Stat label="Ingresos atribuidos (histórico)" value={formatEUR(attributedRevenueAllTime)} />
              </div>
            </div>
            <Link
              href={`/clients/${client.id}/results`}
              className="mt-3 self-start font-mono text-[9.5px] uppercase tracking-wide text-os-dim hover:text-os-accent"
            >
              Ver dashboard completo →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

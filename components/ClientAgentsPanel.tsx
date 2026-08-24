'use client';

import Link from 'next/link';
import {
  getAiAgentCapabilityLabel,
  getAiAgentChannelLabel,
  getAiAgentConfigurationStatus,
  getAiAgentProviderLabel,
  getAiAgentUseCaseLabel,
  type AiAgent,
  type AiAgentStatus,
} from '@/lib/agents-ai';
import { formatOpsRelativeTime, getOpsStatusLabel, OPS_STATUS_TONE, type OpsClientAgentStatus } from '@/lib/ops-status';
import { Badge, SectionHead } from '@/components/terminal';

// Client-scoped Agentes IA tab — Client Truth Alignment V1.
//
// REAL section: this client's real ai_analyzed evidence
// (lib/server/ops-status.ts's getClientOpsSnapshot via
// GET /api/ops/status/client/[clientId]) — the one agent V1 actually
// observes, Lead Qualification. Deliberately never shows a model name: no
// model is ever stored/observed by the real backend, so displaying one
// (e.g. the old seeded "gpt-4o") would misrepresent it as a real runtime
// fact — same rule as the global /ai-agents "Agente real" card.
//
// PLANIFICACIÓN section: the pre-existing localStorage AiAgent roster
// (getAiAgents(clientId) from lib/agents-ai.ts) stays visible only as
// planning/draft records — this is intended configuration, never observed
// runtime truth. Status is translated into planning-only wording
// (Planificado/Pausado (planificación)/Borrador — see PLANNING_STATUS_LABEL
// below; never lib/agents-ai.ts's own "Activo"). Configuration completeness
// is labeled "Configuración prevista: completa/incompleta" and provider/
// model are prefixed "Previsto:" — both explicitly planning metadata, never
// re-labeled as "ready"/"operational"/"healthy" here.

// Planning-only presentation labels — deliberately NOT
// lib/agents-ai.ts's getAiAgentStatusLabel/getAiAgentConfigurationStatusLabel
// (which still say "Activo"/"Configuración completa" and still power the
// global /ai-agents board, unchanged by this pass). Nothing in this
// localStorage roster is observed, so "Activo" — and a green/warn-toned
// "Configuración completa" badge — would visually compete with the real
// agent card's activity_observed status above it. Tone is always 'default'
// here for the same reason the automations planning list uses it.
const PLANNING_STATUS_LABEL: Record<AiAgentStatus, string> = {
  active: 'Planificado',
  paused: 'Pausado (planificación)',
  draft: 'Borrador',
};

/** Deliberately never displays a model name — V1 doesn't observe/store one,
 * so showing a planned/legacy "gpt-4o" here would misrepresent it as a real
 * runtime fact. */
function RealAgentCard({ agent }: { agent: OpsClientAgentStatus }) {
  return (
    <div className="flex flex-col gap-1.5 border border-os-border bg-os-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold leading-tight text-os-text">{agent.name}</div>
          <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
            Provider: {agent.provider} · Execution: {agent.execution}
          </div>
        </div>
        <Badge tone={OPS_STATUS_TONE[agent.status]}>{getOpsStatusLabel(agent.status)}</Badge>
      </div>
      <p className="text-[10px] leading-snug text-os-dim">{agent.detail}</p>
      <div className="mt-1 border-t border-os-border pt-2 font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
        Última actividad: <span className="text-os-muted">{formatOpsRelativeTime(agent.lastActivityAt)}</span>
      </div>
    </div>
  );
}

export function ClientAgentsPanel({
  agents,
  opsAgent,
  opsError,
}: {
  /** Legacy localStorage roster, planning/draft only — never runtime truth. */
  agents: AiAgent[];
  /** This client's real per-clients.id agent evidence. Null while loading. */
  opsAgent: OpsClientAgentStatus | null;
  opsError: string | null;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Agentes IA</h3>
        <Link
          href="/ai-agents"
          className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim hover:text-os-accent"
        >
          Ver en Agentes IA →
        </Link>
      </div>

      <div className="mb-6">
        <SectionHead label="Agente real de este cliente" />
        {opsError ? (
          <div className="border border-os-err/40 bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">{opsError}</div>
        ) : !opsAgent ? (
          <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
            Cargando estado operativo…
          </div>
        ) : (
          <RealAgentCard agent={opsAgent} />
        )}
      </div>

      <div>
        <SectionHead label="Planificación / borradores" count={agents.length} />
        {agents.length === 0 ? (
          <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
            Sin agentes de IA planificados para este cliente.
          </div>
        ) : (
          <div className="space-y-2.5">
            {agents.map((agent) => {
              const configStatus = getAiAgentConfigurationStatus(agent);
              return (
                <div key={agent.id} className="border border-os-border bg-os-surface2 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12.5px] font-semibold text-os-text">{agent.name}</span>
                        <Badge tone="default">{PLANNING_STATUS_LABEL[agent.status]}</Badge>
                        <Badge tone="default">
                          Configuración prevista: {configStatus === 'complete' ? 'completa' : 'incompleta'}
                        </Badge>
                      </div>
                      {agent.role && <div className="mt-1 font-mono text-[10px] text-os-dim">{agent.role}</div>}
                    </div>
                    <div className="shrink-0 text-right font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
                      Previsto: {agent.provider ? getAiAgentProviderLabel(agent.provider) : '—'}
                      {agent.model ? ` · ${agent.model}` : ''}
                    </div>
                  </div>
                  {agent.purpose && <p className="mt-2 text-[11px] leading-relaxed text-os-muted">{agent.purpose}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {agent.channel && (
                      <span className="border border-os-border bg-os-surface px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
                        {getAiAgentChannelLabel(agent.channel)}
                      </span>
                    )}
                    {agent.useCase && (
                      <span className="border border-os-border bg-os-surface px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
                        {getAiAgentUseCaseLabel(agent.useCase)}
                      </span>
                    )}
                    {agent.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className="border border-os-border bg-os-surface px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim"
                      >
                        {getAiAgentCapabilityLabel(capability)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import {
  getAiAgentCapabilityLabel,
  getAiAgentChannelLabel,
  getAiAgentConfigurationStatus,
  getAiAgentConfigurationStatusLabel,
  getAiAgentProviderLabel,
  getAiAgentStatusLabel,
  getAiAgentUseCaseLabel,
  summarizeAiAgents,
  type AiAgent,
  type AiAgentStatus,
} from '@/lib/agents-ai';
import { Badge, type BadgeTone } from '@/components/terminal';

// Client-scoped Agentes IA tab — NEW to the client workspace. Reads the SAME
// AiAgent store the global /ai-agents page uses. getAiAgents(clientId)
// already filters strictly on agent.clientId === clientId, so scope='internal'
// agents (clientId: null) are excluded by construction — never re-included
// here. Configuration status ("Configuración completa/incompleta") reflects
// field completeness only, per lib/agents-ai.ts's documented distinction —
// this view never re-labels it as "ready"/"operational"/"healthy", since no
// runtime/run-history exists behind these agents in V1.

const STATUS_TONE: Record<AiAgentStatus, BadgeTone> = {
  active: 'ok',
  paused: 'default',
  draft: 'default',
};

export function ClientAgentsPanel({ agents }: { agents: AiAgent[] }) {
  const summary = summarizeAiAgents(agents);

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

      {agents.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          Sin agentes de IA configurados para este cliente.
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { label: 'Activos', value: String(summary.active) },
              { label: 'Borrador', value: String(summary.draft) },
              { label: 'Configuración incompleta', value: String(summary.incompleteConfiguration) },
            ].map((tile) => (
              <div key={tile.label} className="border border-os-border bg-os-surface2 px-3 py-2.5">
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{tile.label}</div>
                <div className="mt-1.5 font-mono text-[15px] font-semibold text-os-text">{tile.value}</div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {agents.map((agent) => {
              const configStatus = getAiAgentConfigurationStatus(agent);
              return (
                <div key={agent.id} className="border border-os-border bg-os-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-os-text">{agent.name}</span>
                        <Badge tone={STATUS_TONE[agent.status]}>{getAiAgentStatusLabel(agent.status)}</Badge>
                        <Badge tone={configStatus === 'complete' ? 'ok' : 'warn'}>
                          {getAiAgentConfigurationStatusLabel(configStatus)}
                        </Badge>
                      </div>
                      {agent.role && <div className="mt-1 font-mono text-[10px] text-os-dim">{agent.role}</div>}
                    </div>
                    <div className="shrink-0 text-right font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
                      {agent.provider ? getAiAgentProviderLabel(agent.provider) : '—'}
                      {agent.model ? ` · ${agent.model}` : ''}
                    </div>
                  </div>
                  {agent.purpose && <p className="mt-2 text-[12px] leading-relaxed text-os-muted">{agent.purpose}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {agent.channel && (
                      <span className="border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
                        {getAiAgentChannelLabel(agent.channel)}
                      </span>
                    )}
                    {agent.useCase && (
                      <span className="border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
                        {getAiAgentUseCaseLabel(agent.useCase)}
                      </span>
                    )}
                    {agent.capabilities.map((capability) => (
                      <span
                        key={capability}
                        className="border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim"
                      >
                        {getAiAgentCapabilityLabel(capability)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

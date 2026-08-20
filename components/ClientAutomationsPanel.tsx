'use client';

import Link from 'next/link';
import {
  getAutomationHealth,
  getAutomationStats,
  getHealthLabel,
  getPlatformLabel,
  getStatusLabel,
  getTypeLabel,
  summarizeAutomations,
  type Automation,
  type AutomationHealth,
  type AutomationStatus,
} from '@/lib/automations';
import { Badge, type BadgeTone } from '@/components/terminal';

// Client-scoped Automations tab — reads the SAME Automation store the global
// /automations page uses (getAutomations(clientId) filters by clientId; no
// client-specific automation store). Read-only here: editing/toggling still
// happens on /automations. Lifecycle status (active/paused/draft) and health
// (healthy/needs_attention/never_run) are kept visually distinct, same
// discipline lib/automations.ts documents — a paused automation is never
// "healthy" or "unhealthy", and an active one can still need attention.

function formatRelative(value: string | null): string {
  if (!value) return 'Sin ejecuciones';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffHours = Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours < 24) return `hace ${Math.max(1, Math.round(diffHours))}h`;
  return `hace ${Math.round(diffHours / 24)}d`;
}

function formatPercent(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

const STATUS_TONE: Record<AutomationStatus, BadgeTone> = {
  active: 'ok',
  paused: 'default',
  draft: 'default',
};

const HEALTH_TONE: Record<AutomationHealth, BadgeTone> = {
  healthy: 'ok',
  needs_attention: 'err',
  never_run: 'default',
};

export function ClientAutomationsPanel({ automations }: { automations: Automation[] }) {
  const summary = summarizeAutomations(automations);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Automatizaciones</h3>
        <Link
          href="/automations"
          className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim hover:text-os-accent"
        >
          Ver en Automatizaciones →
        </Link>
      </div>

      {automations.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          Sin automatizaciones para este cliente.
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Activas', value: String(summary.active) },
              { label: 'Requieren atención', value: String(summary.needsAttention) },
              { label: 'Ejecuciones totales', value: String(summary.totalRuns) },
              { label: 'Tasa de éxito', value: formatPercent(summary.successRate) },
            ].map((tile) => (
              <div key={tile.label} className="border border-os-border bg-os-surface2 px-3 py-2.5">
                <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{tile.label}</div>
                <div className="mt-1.5 font-mono text-[15px] font-semibold text-os-text">{tile.value}</div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {automations.map((automation) => {
              const health = getAutomationHealth(automation);
              const stats = getAutomationStats(automation.id);
              return (
                <div key={automation.id} className="border border-os-border bg-os-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-os-text">{automation.name}</span>
                        <Badge tone={STATUS_TONE[automation.status]}>{getStatusLabel(automation.status)}</Badge>
                        <Badge tone={HEALTH_TONE[health]}>{getHealthLabel(health)}</Badge>
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-os-dim">{getTypeLabel(automation.type)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
                        {formatRelative(automation.lastRunAt)}
                      </div>
                      <div className="mt-0.5 font-mono text-[9.5px] text-os-muted">
                        {stats.totalRuns} ejecuciones · {formatPercent(stats.successRate)} éxito
                      </div>
                    </div>
                  </div>
                  {automation.description && (
                    <p className="mt-2 text-[12px] leading-relaxed text-os-muted">{automation.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {automation.platforms.map((platform) => (
                      <span
                        key={platform}
                        className="border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim"
                      >
                        {getPlatformLabel(platform)}
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

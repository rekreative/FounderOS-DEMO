'use client';

import Link from 'next/link';
import { getStageLabel, type Lead, type LeadIntent, type LeadStage } from '@/lib/leads';
import { Badge, type BadgeTone } from '@/components/terminal';

// Client-scoped Leads tab — reads the SAME Lead store the global /leads page
// uses (getLeads(clientId) filters by clientId; there is no client-specific
// lead store). Read-only here: stage changes/notes still happen on /leads.
// Deliberately never references MetaCampaign.leads (Meta-attributed ad
// leads) — this tab shows CRM leads only, same distinction lib/results.ts
// enforces between counts.leads and metaLeads.

const CLOSED_STAGES: LeadStage[] = ['converted', 'disqualified', 'no_response'];

// Presentation-only mapping — lead.aiAnalysis.intent itself is never
// touched, just how it reads here. Matches app/leads/page.tsx's
// AI_INTENT_LABEL exactly, so the global and client-scoped Leads views never
// disagree. Kept explicitly separate from CRM stage (the "Etapa" column).
const AI_INTENT_LABEL: Record<LeadIntent, string> = {
  hot: 'ALTA',
  warm: 'MEDIA',
  cold: 'BAJA',
};

const STAGE_TONE: Record<LeadStage, BadgeTone> = {
  new: 'accent',
  contacted: 'default',
  qualified: 'default',
  appointment: 'warn',
  converted: 'ok',
  no_response: 'default',
  disqualified: 'err',
};

function formatRelative(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffHours = Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours < 24) return `hace ${Math.max(1, Math.round(diffHours))}h`;
  return `hace ${Math.round(diffHours / 24)}d`;
}

export function ClientLeadsPanel({ leads }: { leads: Lead[] }) {
  const openCount = leads.filter((lead) => !CLOSED_STAGES.includes(lead.stage)).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Leads</h3>
        <Link href="/leads" className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim hover:text-os-accent">
          Ver en Leads →
        </Link>
      </div>

      {leads.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          Sin leads registrados para este cliente.
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-2">
            <div className="border border-os-border bg-os-surface2 px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Total</div>
              <div className="mt-1.5 font-mono text-[15px] font-semibold text-os-text">{leads.length}</div>
            </div>
            <div className="border border-os-border bg-os-surface2 px-3 py-2.5">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Abiertos</div>
              <div className="mt-1.5 font-mono text-[15px] font-semibold text-os-text">{openCount}</div>
            </div>
          </div>

          <div className="overflow-hidden border border-os-border bg-os-surface">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-os-surface2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
                  <th className="px-3 py-2 font-normal">Lead</th>
                  <th className="px-3 py-2 font-normal">Etapa</th>
                  <th className="px-3 py-2 font-normal">Origen</th>
                  <th className="px-3 py-2 font-normal">Intención IA</th>
                  <th className="px-3 py-2 font-normal">Última actividad</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-t border-os-border align-top">
                    <td className="px-3 py-2.5">
                      <div className="text-[13px] font-semibold text-os-text">{lead.name}</div>
                      <div className="mt-0.5 text-[10px] text-os-dim">
                        {lead.email || lead.phone || lead.whatsapp || 'Sin contacto'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={STAGE_TONE[lead.stage]}>{getStageLabel(lead.stage)}</Badge>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">{lead.source}</td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-muted">
                      {lead.aiAnalysis?.intent ? AI_INTENT_LABEL[lead.aiAnalysis.intent] : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[10.5px] text-os-dim">
                      {formatRelative(lead.lastActivityAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

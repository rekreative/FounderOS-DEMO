'use client';

import Link from 'next/link';
import { getPlatformLabel, type Automation, type AutomationStatus } from '@/lib/automations';
import { formatOpsRelativeTime, getOpsStatusLabel, OPS_STATUS_TONE, type OpsClientAutomationStatus } from '@/lib/ops-status';
import { Badge, SectionHead } from '@/components/terminal';

// Client-scoped Automations tab — Client Truth Alignment V1.
//
// REAL section: the same 5 canonical workflows and status vocabulary as the
// global /automations "Flujos reales" section (lib/server/ops-status.ts's
// getClientOpsSnapshot via GET /api/ops/status/client/[clientId]), scoped to
// this client's own PostgreSQL clients.id — never the localStorage
// Automation store's fictional client ids. No execution count, no failure
// count, no success rate: none of that is real for a single client in V1.
//
// PLANIFICACIÓN section: the pre-existing localStorage Automation catalog
// (getAutomations(clientId) from lib/automations.ts) stays visible, but only
// as planning/draft records — name, description, platforms, and a lifecycle
// label translated into planning-only wording (Planificada/Pausada
// (planificación)/Borrador — see PLANNING_STATUS_LABEL below; never lib/
// automations.ts's own "Activa", which reads as observed runtime state).
// The fabricated run-history health badge ("Operativa"/"Requiere atención")
// and the "N ejecuciones · X% éxito" line are deliberately dropped here:
// that telemetry is seeded demo data, and this tab must never present it as
// observed runtime truth.

const AUTOMATION_DESCRIPTION_ES: Record<string, string> = {
  'Meta lead form triggers a Make scenario: OpenAI qualifies the lead, logs it to the REKREATIVE CRM and the client tracking sheet, then WhatsApp Business Cloud sends the welcome template.':
    'El formulario de leads de Meta activa un escenario de Make: OpenAI cualifica al lead, lo registra en el CRM de REKREATIVE y en la hoja de seguimiento del cliente, y WhatsApp Business Cloud envía la plantilla de bienvenida.',
  'When a discovery call is booked in the CRM calendar, a Make scenario sends a WhatsApp reminder template 24h before the call.':
    'Cuando se agenda una llamada de descubrimiento en el calendario del CRM, un escenario de Make envía una plantilla de recordatorio por WhatsApp 24 horas antes de la llamada.',
  'Contacts tagged "warm" in ManyChat receive a 3-message nurture sequence over Instagram DMs. Paused while the creative brief is refreshed.':
    'Los contactos etiquetados como "tibios" en ManyChat reciben una secuencia de 3 mensajes de seguimiento por DM de Instagram. Pausada mientras se actualiza el brief creativo.',
  'Draft automation: once a lead is marked converted in the CRM, send a WhatsApp message asking for a review. Not yet launched.':
    'Automatización en borrador: cuando un lead se marca como convertido en el CRM, se envía un mensaje de WhatsApp pidiendo una reseña. Aún no está lanzada.',
  'Active but never triggered yet: notifies the internal team and logs a row in Google Sheets whenever a client’s status changes to active.':
    'Activa pero todavía sin activarse nunca: notifica al equipo interno y registra una fila en Google Sheets cada vez que el estado de un cliente cambia a activo.',
  'Every Monday, aggregates the past week’s lead and campaign numbers into the client tracking sheet.':
    'Cada lunes, agrega los datos de leads y campañas de la semana anterior en la hoja de seguimiento del cliente.',
};

function translateAutomationDescription(description: string): string {
  return AUTOMATION_DESCRIPTION_ES[description] ?? description;
}

// Planning-only presentation labels — deliberately NOT lib/automations.ts's
// getStatusLabel/AUTOMATION_STATUS_OPTIONS (which still say "Activa" and
// still power the global /automations board, unchanged by this pass).
// "Activa" reads as observed runtime truth; nothing in this localStorage
// catalog is observed, so this tab must say so in the label itself, not
// just in the section heading above it. Tone is always 'default' (neutral)
// here too — never the green 'ok' the real section's activity_observed
// badge uses, so a planning card can never be mistaken for one at a glance.
const PLANNING_STATUS_LABEL: Record<AutomationStatus, string> = {
  active: 'Planificada',
  paused: 'Pausada (planificación)',
  draft: 'Borrador',
};

function RealWorkflowCard({ workflow }: { workflow: OpsClientAutomationStatus }) {
  return (
    <div className="flex flex-col gap-1.5 border border-os-border bg-os-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold leading-tight text-os-text">{workflow.name}</div>
          <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-wide text-os-dim">{workflow.execution}</div>
        </div>
        <Badge tone={OPS_STATUS_TONE[workflow.status]}>{getOpsStatusLabel(workflow.status)}</Badge>
      </div>
      <p className="text-[10.5px] leading-snug text-os-muted">{workflow.purpose}</p>
      <p className="text-[10px] leading-snug text-os-dim">{workflow.detail}</p>
      <div className="mt-1 border-t border-os-border pt-2 font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
        Última actividad: <span className="text-os-muted">{formatOpsRelativeTime(workflow.lastActivityAt)}</span>
      </div>
    </div>
  );
}

export function ClientAutomationsPanel({
  automations,
  opsAutomations,
  opsError,
}: {
  /** Legacy localStorage catalog, planning/draft only — never runtime truth. */
  automations: Automation[];
  /** This client's real per-clients.id evidence. Null while loading. */
  opsAutomations: OpsClientAutomationStatus[] | null;
  opsError: string | null;
}) {
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

      <div className="mb-6">
        <SectionHead label="Flujos reales de este cliente" count={opsAutomations?.length ?? 0} />
        {opsError ? (
          <div className="border border-os-err/40 bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">{opsError}</div>
        ) : !opsAutomations ? (
          <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
            Cargando estado operativo…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {opsAutomations.map((workflow) => (
              <RealWorkflowCard key={workflow.id} workflow={workflow} />
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionHead label="Planificación / borradores" count={automations.length} />
        {automations.length === 0 ? (
          <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
            Sin automatizaciones planificadas para este cliente.
          </div>
        ) : (
          <div className="space-y-2.5">
            {automations.map((automation) => (
              <div key={automation.id} className="border border-os-border bg-os-surface2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-os-text">{automation.name}</span>
                  <Badge tone="default">{PLANNING_STATUS_LABEL[automation.status]}</Badge>
                </div>
                {automation.description && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-os-muted">
                    {translateAutomationDescription(automation.description)}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {automation.platforms.map((platform) => (
                    <span
                      key={platform}
                      className="border border-os-border bg-os-surface px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim"
                    >
                      {getPlatformLabel(platform)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

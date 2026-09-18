'use client';

import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  appendCommercialEvent,
  appendLeadEvent,
  getLeadEvents,
  getLeads,
  setLeadStage,
  type CommercialEventType,
  type Lead,
  type LeadEvent,
} from '@/lib/api/leads';
import { LEAD_STAGE_OPTIONS, getStageLabel, type LeadStage } from '@/lib/leads';

const STAGE_STYLE: Record<LeadStage, string> = {
  new: 'border-[var(--funnel-s0)] text-os-text',
  contacted: 'border-[var(--funnel-s1)] text-os-text',
  qualified: 'border-[var(--funnel-s2)] text-os-text',
  appointment: 'border-[var(--funnel-s3)] text-os-text',
  proposal_sent: 'border-[var(--lead-proposal)] text-os-text',
  converted: 'border-os-ok text-os-ok',
  no_response: 'border-os-warn text-os-warn',
  disqualified: 'border-os-err text-os-err',
};

const EVENT_LABEL: Record<LeadEvent['type'], string> = {
  lead_received: 'Lead recibido',
  ai_analyzed: 'Analizado por IA',
  whatsapp_sent: 'WhatsApp enviado',
  whatsapp_delivered: 'WhatsApp entregado',
  whatsapp_failed: 'WhatsApp no enviado',
  lead_replied: 'Lead respondió',
  commercial_contacted: 'Contacto comercial',
  qualified: 'Cualificado',
  appointment_booked: 'Cita agendada',
  appointment_completed: 'Cita realizada',
  proposal_sent: 'Propuesta enviada',
  converted: 'Convertido',
  payment_received: 'Cobro registrado',
  meta_capi_test: 'Meta CAPI',
  meta_capi_live: 'Meta CAPI automático',
  disqualified: 'Descartado',
  manual_note: 'Nota',
  stage_changed: 'Etapa actualizada',
};

const SAFE_STAGE_CHANGES: LeadStage[] = ['new', 'contacted', 'no_response'];

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

function toIsoDate(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function WhatsAppState({ lead }: { lead: Lead }) {
  if (lead.phoneQuality?.status === 'invalid') {
    return <span className="border border-os-err px-2 py-1 font-mono text-[9px] uppercase text-os-err">Teléfono inválido</span>;
  }
  const state = lead.whatsappStatus?.state ?? 'not_sent';
  const labels = {
    not_sent: ['Sin confirmación WA', 'border-os-border text-os-dim'],
    accepted: ['WA aceptado', 'border-os-warn text-os-warn'],
    delivered: ['WA entregado', 'border-os-ok text-os-ok'],
    replied: ['Respondió', 'border-os-ok text-os-ok'],
    failed: ['WA no enviado', 'border-os-err text-os-err'],
  } as const;
  const [label, style] = labels[state];
  return <span className={`border px-2 py-1 font-mono text-[9px] uppercase ${style}`}>{label}</span>;
}

type Props = {
  clientId: string;
  initialLeads: Lead[];
};

export function ClientPortalLeadManager({ clientId, initialLeads }: Props) {
  const [leads, setLeads] = useState(initialLeads);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | LeadStage>('all');
  const [note, setNote] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [showAppointment, setShowAppointment] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = leads.find((lead) => lead.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return leads.filter((lead) => {
      if (stageFilter !== 'all' && lead.stage !== stageFilter) return false;
      if (!normalized) return true;
      return [lead.name, lead.email, lead.phone, lead.whatsapp, lead.campaign]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [leads, query, stageFilter]);

  async function refreshLeads(preferredId = selectedId) {
    const next = await getLeads({ clientId });
    setLeads(next);
    if (preferredId && !next.some((lead) => lead.id === preferredId)) setSelectedId(null);
  }

  async function openLead(lead: Lead) {
    setSelectedId(lead.id);
    setError(null);
    setLoadingEvents(true);
    try {
      setEvents(await getLeadEvents(lead.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el historial.');
    } finally {
      setLoadingEvents(false);
    }
  }

  async function runMutation(action: () => Promise<unknown>) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await action();
      await Promise.all([refreshLeads(selected.id), getLeadEvents(selected.id).then(setEvents)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el cambio.');
    } finally {
      setSaving(false);
    }
  }

  async function changeStage(stage: LeadStage) {
    if (!selected || stage === selected.stage) return;
    await runMutation(() => setLeadStage(selected.id, stage));
  }

  async function addNote() {
    const summary = note.trim();
    if (!selected || !summary) return;
    await runMutation(() => appendLeadEvent(selected.id, { summary }));
    setNote('');
  }

  async function commercialEvent(type: CommercialEventType) {
    if (!selected) return;
    await runMutation(() => appendCommercialEvent(selected.id, { type } as Parameters<typeof appendCommercialEvent>[1]));
  }

  async function bookAppointment() {
    if (!selected) return;
    const iso = toIsoDate(appointmentDate);
    if (!iso) {
      setError('Selecciona una fecha y hora válidas para la cita.');
      return;
    }
    await runMutation(() => appendCommercialEvent(selected.id, { type: 'appointment_booked', appointmentDate: iso }));
    setAppointmentDate('');
    setShowAppointment(false);
  }

  const isTerminal = selected?.stage === 'converted' || selected?.stage === 'disqualified';

  return (
    <section className="mt-8 border-t border-os-border pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-os-accent">CRM</p>
          <h2 className="mt-1 text-xl font-semibold">Gestión de leads</h2>
          <p className="mt-1 text-sm text-os-dim">Consulta cada contacto y actualiza su avance comercial.</p>
        </div>
        <div className="font-mono text-[10px] uppercase text-os-dim">{filtered.length} de {leads.length} leads</div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <label className="flex items-center gap-2 border border-os-border bg-os-surface px-3 py-2">
          <Search className="h-4 w-4 text-os-dim" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nombre, email o teléfono" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-os-dim" />
        </label>
        <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value as 'all' | LeadStage)} className="border border-os-border bg-os-surface px-3 py-2 text-sm text-os-text">
          <option value="all">Todas las etapas</option>
          {LEAD_STAGE_OPTIONS.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
        </select>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((lead) => (
          <button key={lead.id} type="button" onClick={() => openLead(lead)} className={`border border-l-4 bg-os-surface p-4 text-left transition-colors hover:bg-os-surface2 ${STAGE_STYLE[lead.stage]}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-os-text">{lead.name}</div>
                <div className="mt-1 truncate text-xs text-os-dim">{lead.email ?? 'Sin email'}</div>
                <div className="mt-0.5 truncate text-xs text-os-dim">{lead.phone ?? lead.whatsapp ?? 'Sin teléfono'}</div>
              </div>
              <span className={`shrink-0 border px-2 py-1 font-mono text-[9px] uppercase ${STAGE_STYLE[lead.stage]}`}>{getStageLabel(lead.stage)}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-os-border pt-3">
              <WhatsAppState lead={lead} />
              <span className="font-mono text-[9px] text-os-dim">{formatDate(lead.lastActivityAt)}</span>
            </div>
          </button>
        ))}
        {filtered.length === 0 && <div className="md:col-span-2 xl:col-span-3 border border-dashed border-os-border p-8 text-center text-sm text-os-dim">No hay leads que coincidan con el filtro.</div>}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/65" role="dialog" aria-modal="true" aria-label={`Lead ${selected.name}`}>
          <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-os-border bg-os-bg p-4 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-os-accent">Ficha del lead</p>
                <h3 className="mt-1 text-xl font-semibold">{selected.name}</h3>
                <p className="mt-1 text-sm text-os-dim">{selected.email ?? 'Sin email'} · {selected.phone ?? selected.whatsapp ?? 'Sin teléfono'}</p>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} aria-label="Cerrar ficha" className="border border-os-border p-2 text-os-dim hover:text-os-text"><X className="h-4 w-4" /></button>
            </div>

            {error && <div className="mt-4 border border-os-err bg-os-err/10 px-3 py-2 text-sm text-os-err">{error}</div>}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="border border-os-border bg-os-surface p-3"><div className="font-mono text-[9px] uppercase text-os-dim">Origen</div><div className="mt-1 text-sm">{selected.source}</div><div className="mt-1 text-xs text-os-dim">{selected.campaign ?? 'Sin campaña'}</div></div>
              <div className="border border-os-border bg-os-surface p-3"><div className="font-mono text-[9px] uppercase text-os-dim">Próxima cita</div><div className="mt-1 text-sm">{formatDate(selected.appointmentDate)}</div></div>
            </div>

            {selected.aiAnalysis?.summary && <div className="mt-3 border border-os-border bg-os-surface p-3"><div className="font-mono text-[9px] uppercase text-os-dim">Análisis inicial</div><p className="mt-2 text-sm leading-relaxed text-os-muted">{selected.aiAnalysis.summary}</p></div>}

            <section className="mt-5 border border-os-border bg-os-surface p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-os-muted">Actualizar estado</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {SAFE_STAGE_CHANGES.map((stage) => <button key={stage} type="button" disabled={saving || isTerminal || selected.stage === stage} onClick={() => changeStage(stage)} className="border border-os-border px-2.5 py-1.5 text-xs text-os-muted hover:border-os-border-strong disabled:opacity-35">{getStageLabel(stage)}</button>)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-os-border pt-3">
                <button type="button" disabled={saving || isTerminal || selected.stage === 'qualified'} onClick={() => commercialEvent('qualified')} className="border border-[var(--funnel-s2)] px-2.5 py-1.5 text-xs disabled:opacity-35">Cualificado</button>
                <button type="button" disabled={saving || isTerminal} onClick={() => setShowAppointment((current) => !current)} className="border border-[var(--funnel-s3)] px-2.5 py-1.5 text-xs disabled:opacity-35">Cita agendada</button>
                <button type="button" disabled={saving || isTerminal} onClick={() => commercialEvent('appointment_completed')} className="border border-os-border px-2.5 py-1.5 text-xs disabled:opacity-35">Cita realizada</button>
                <button type="button" disabled={saving || isTerminal || selected.stage === 'proposal_sent'} onClick={() => commercialEvent('proposal_sent')} className="border border-[var(--lead-proposal)] px-2.5 py-1.5 text-xs disabled:opacity-35">Propuesta enviada</button>
                <button type="button" disabled={saving || isTerminal} onClick={() => commercialEvent('converted')} className="border border-os-ok px-2.5 py-1.5 text-xs text-os-ok disabled:opacity-35">Convertido</button>
                <button type="button" disabled={saving || isTerminal} onClick={() => commercialEvent('disqualified')} className="border border-os-err px-2.5 py-1.5 text-xs text-os-err disabled:opacity-35">No cualificado</button>
              </div>
              {showAppointment && <div className="mt-3 flex flex-col gap-2 border-t border-os-border pt-3 sm:flex-row"><input type="datetime-local" value={appointmentDate} onChange={(event) => setAppointmentDate(event.target.value)} className="min-w-0 flex-1 border border-os-border bg-os-bg px-3 py-2 text-sm" /><button type="button" disabled={saving || !appointmentDate} onClick={bookAppointment} className="border border-os-accent bg-os-accent px-3 py-2 font-mono text-[10px] uppercase text-os-bg disabled:opacity-40">Guardar cita</button></div>}
            </section>

            <section className="mt-4 border border-os-border bg-os-surface p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-os-muted">Notas de llamada</div>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder="Escribe aquí mientras hablas con el lead..." className="mt-3 w-full resize-y border border-os-border bg-os-bg p-3 text-sm outline-none placeholder:text-os-dim" />
              <div className="mt-2 flex justify-end"><button type="button" disabled={saving || !note.trim()} onClick={addNote} className="border border-os-accent bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase text-os-bg disabled:opacity-40">Guardar nota</button></div>
            </section>

            <section className="mt-4 border border-os-border bg-os-surface p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-os-muted">Timeline</div>
              {loadingEvents ? <p className="mt-3 text-sm text-os-dim">Cargando historial...</p> : <div className="mt-3 divide-y divide-os-border">{events.slice().reverse().map((event) => <article key={event.id} className="py-3"><div className="flex items-start justify-between gap-3"><div className="text-sm font-medium">{EVENT_LABEL[event.type]}</div><time className="shrink-0 font-mono text-[9px] text-os-dim">{formatDate(event.occurredAt)}</time></div><p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-os-muted">{event.summary}</p></article>)}{events.length === 0 && <p className="py-4 text-sm text-os-dim">Todavía no hay actividad registrada.</p>}</div>}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}

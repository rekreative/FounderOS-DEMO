'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useClientsRegistry } from '@/components/ClientsProvider';
import {
  LEAD_SCOPE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  getClientNameForLead,
  type LeadIntent,
  type LeadPriority,
  type LeadScope,
  type LeadStage,
} from '@/lib/leads';
import {
  appendLeadEvent,
  createLead,
  getLeadEvents,
  getLeads,
  setLeadStage,
  updateLead,
  type Lead,
  type LeadEvent,
} from '@/lib/api/leads';

const STAGE_FILTERS = [{ id: 'all', label: 'Todos' }, ...LEAD_STAGE_OPTIONS];

// Presentation-only mapping — lead.aiAnalysis.intent itself is never
// touched, just how it reads in the table. Kept explicitly separate from
// CRM stage (the "Etapa" column/select, a few cells over).
const AI_INTENT_LABEL: Record<LeadIntent, string> = {
  hot: 'ALTA',
  warm: 'MEDIA',
  cold: 'BAJA',
};

// Same presentation convention as AI_INTENT_LABEL — never render the raw
// 'low'/'medium'/'high' enum value in the UI.
const AI_PRIORITY_LABEL: Record<LeadPriority, string> = {
  high: 'ALTA',
  medium: 'MEDIA',
  low: 'BAJA',
};

type DraftLead = {
  clientId: string;
  name: string;
  email: string;
  phone: string;
  whatsapp: string;
  source: string;
  campaign: string;
  adCreative: string;
  form: string;
  stage: LeadStage;
};

const emptyDraft = (clientId = ''): DraftLead => ({
  clientId,
  name: '',
  email: '',
  phone: '',
  whatsapp: '',
  source: 'Meta Ads',
  campaign: '',
  adCreative: '',
  form: '',
  stage: 'new',
});

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatRelative(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffHours = Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours < 24) {
    return `hace ${Math.max(1, Math.round(diffHours))}h`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `hace ${diffDays}d`;
}

function eventLabel(type: LeadEvent['type']): string {
  const map: Record<LeadEvent['type'], string> = {
    lead_received: 'Lead recibido',
    ai_analyzed: 'Analizado por IA',
    whatsapp_sent: 'WhatsApp enviado',
    whatsapp_delivered: 'WhatsApp entregado',
    lead_replied: 'Lead respondió',
    commercial_contacted: 'Contacto comercial',
    appointment_booked: 'Cita reservada',
    appointment_completed: 'Cita completada',
    converted: 'Convertido',
    disqualified: 'Descartado',
    manual_note: 'Nota manual',
    stage_changed: 'Etapa cambiada',
  };
  return map[type] ?? type;
}

function LeadRow({
  lead,
  clients,
  events,
  eventsLoading,
  showClientColumn,
  columnCount,
  expanded,
  onToggle,
  onStageChange,
  onEdit,
  onAddNote,
}: {
  lead: Lead;
  clients: { id: string; name: string }[];
  events: LeadEvent[];
  eventsLoading: boolean;
  /** REKREATIVE scope: every row is already known to be internal, so the
   * Cliente column is redundant — hidden there, shown as-is in CLIENTES scope. */
  showClientColumn: boolean;
  /** Current visible column count (9 with Cliente shown, 8 without) — keeps
   * the expanded row's colSpan aligned with the header in both scopes. */
  columnCount: number;
  expanded: boolean;
  onToggle: () => void;
  onStageChange: (nextStage: LeadStage) => void;
  onEdit: () => void;
  onAddNote: () => void;
}) {
  const clientName = getClientNameForLead(lead.clientId, clients);
  const aiIntent = lead.aiAnalysis?.intent ? AI_INTENT_LABEL[lead.aiAnalysis.intent] : '—';

  return (
    <>
      <tr className="border-t border-os-border align-top">
        <td className="px-3 py-3 text-left">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onToggle}
                className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent"
              >
                {expanded ? '−' : '+'}
              </button>
              <div>
                <div className="truncate text-[13px] font-semibold text-os-text">{lead.name}</div>
                <div className="mt-0.5 text-[10px] text-os-dim">{lead.email || lead.phone || lead.whatsapp || 'Sin contacto'}</div>
              </div>
            </div>
          </div>
        </td>
        {showClientColumn && <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{clientName}</td>}
        <td className="px-3 py-3 text-left">
          <select
            value={lead.stage}
            onChange={(event) => onStageChange(event.target.value as LeadStage)}
            className="w-full min-w-[120px] border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text outline-none"
          >
            {LEAD_STAGE_OPTIONS.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.label}
              </option>
            ))}
          </select>
        </td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{aiIntent}</td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{lead.source}</td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{lead.campaign || '—'}</td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-dim">{formatRelative(lead.lastActivityAt)}</td>
        <td className="px-3 py-3 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            {lead.email && (
              <span className="inline-block border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
                Email
              </span>
            )}
            {lead.phone && (
              <span className="inline-block border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
                Tel
              </span>
            )}
            {lead.whatsapp && (
              <span className="inline-block border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim">
                WA
              </span>
            )}
            {!lead.email && !lead.phone && !lead.whatsapp && <span className="font-mono text-[10px] text-os-dim">—</span>}
          </div>
        </td>
        <td className="px-3 py-3 text-right">
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={onAddNote}
              className="border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-dim hover:border-os-border-strong hover:text-os-accent"
            >
              Añadir nota
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-muted hover:border-os-border-strong hover:text-os-accent"
            >
              Editar
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={columnCount} className="border-t border-os-border bg-os-surface px-3 py-3">
            {/* Contact details — the real values the operator needs to reach
                this person, never invented. The main row stays compact; this
                is the one place they're shown in full. */}
            <div className="mb-3 border-b border-os-border pb-3">
              <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Datos de contacto</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Email</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-os-text">
                    {lead.email ? (
                      <a href={`mailto:${lead.email}`} className="hover:text-os-accent">
                        {lead.email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Teléfono</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-os-text">
                    {lead.phone ? (
                      <a href={`tel:${lead.phone}`} className="hover:text-os-accent">
                        {lead.phone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">WhatsApp</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-os-text">
                    {lead.whatsapp ? (
                      <a
                        href={`https://wa.me/${lead.whatsapp.replace(/[^\d]/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-os-accent"
                      >
                        {lead.whatsapp}
                      </a>
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* What the lead actually submitted — rendered verbatim, never
                rewritten or reinterpreted. Same neutral register as the
                contact block above: this is raw input, not a machine
                judgment. */}
            {lead.qualificationAnswers && Object.keys(lead.qualificationAnswers).length > 0 && (
              <div className="mb-3 border-b border-os-border pb-3">
                <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Respuestas del formulario</div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {Object.entries(lead.qualificationAnswers).map(([question, answer]) => (
                    <div key={question} className="min-w-0">
                      <div className="break-words font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{question}</div>
                      <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-os-text">{answer}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI-derived interpretation — visually flagged with the "IA"
                accent tag (same accent tokens as the active scope/stage
                filters above) so it never reads as if the lead submitted
                this itself. */}
            {lead.aiAnalysis && (
              <div className="mb-3 border-b border-os-border pb-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Análisis IA</span>
                  <span className="inline-block border border-[var(--accent-line)] bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-accent">
                    IA
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="col-span-2 sm:col-span-3">
                    <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Resumen</div>
                    <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-os-text">
                      {lead.aiAnalysis.summary || '—'}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Intención</div>
                    <div className="mt-1 font-mono text-[11px] text-os-text">
                      {lead.aiAnalysis.intent ? AI_INTENT_LABEL[lead.aiAnalysis.intent] : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Prioridad</div>
                    <div className="mt-1 font-mono text-[11px] text-os-text">
                      {lead.aiAnalysis.priority ? AI_PRIORITY_LABEL[lead.aiAnalysis.priority] : '—'}
                    </div>
                  </div>
                </div>
                {lead.aiAnalysis.qualification && Object.keys(lead.aiAnalysis.qualification).length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Evaluación IA</div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {Object.entries(lead.aiAnalysis.qualification).map(([key, value]) => (
                        <div key={key} className="min-w-0">
                          <div className="break-words font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">{key}</div>
                          <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-os-text">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Línea de tiempo</span>
              {!eventsLoading && <span className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">{events.length} eventos</span>}
            </div>
            {eventsLoading ? (
              <span className="font-mono text-[10px] text-os-dim">Cargando línea de tiempo…</span>
            ) : events.length === 0 ? (
              <span className="font-mono text-[10px] text-os-dim">Sin eventos en la línea de tiempo.</span>
            ) : (
              // Its own horizontal scroll region — a long real history scrolls
              // in place rather than compressing cards or clipping later
              // events, independent of the table's own overflow-x-auto.
              <div className="overflow-x-auto">
                <div className="flex items-center gap-1.5 pb-1">
                  {events.map((event, index) => (
                    <div key={event.id} className="flex shrink-0 items-center gap-1.5">
                      {index > 0 && <span className="font-mono text-[9px] text-os-dim">→</span>}
                      <div className="flex shrink-0 flex-col gap-0.5 rounded-sm-t border border-os-border bg-os-surface2 px-2.5 py-1.5">
                        <span className="whitespace-nowrap font-mono text-[9.5px] uppercase tracking-wide text-os-text">
                          {eventLabel(event.type)}
                        </span>
                        <span className="whitespace-nowrap font-mono text-[8.5px] text-os-dim">{formatDateTime(event.occurredAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function LeadsPage() {
  const { clients } = useClientsRegistry();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Primary scope: REKREATIVE's own leads vs. client leads — conceptually
  // ABOVE client filtering, never a fake client. Defaults to REKREATIVE.
  // Local UI state only, same as every other filter here.
  const [moduleScope, setModuleScope] = useState<LeadScope>('internal');
  const [stageFilter, setStageFilter] = useState<'all' | LeadStage>('all');
  const [clientFilter, setClientFilter] = useState<'all' | string>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [eventsByLeadId, setEventsByLeadId] = useState<Record<string, LeadEvent[]>>({});
  const [eventsLoadingId, setEventsLoadingId] = useState<Record<string, boolean>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [noteLeadId, setNoteLeadId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [draft, setDraft] = useState<DraftLead>(emptyDraft());

  // In REKREATIVE scope the client selector is hidden and irrelevant, so
  // always load the full set (internal leads have no clientId to filter
  // by); the scope filter below narrows it. In CLIENTES scope, behavior is
  // unchanged from before scope existed.
  const fetchLeads = useCallback(() => {
    return moduleScope === 'internal' ? getLeads() : getLeads(clientFilter === 'all' ? {} : { clientId: clientFilter });
  }, [moduleScope, clientFilter]);

  // Async, cancellation-guarded: a rapid scope/client-filter change (or an
  // unmount mid-flight) must never let a stale response overwrite a newer
  // one — no flashing wrong data, and never fabricated fallback data on
  // failure (an honest error state instead).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchLeads()
      .then((result) => {
        if (cancelled) return;
        setLeads(result);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los leads.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchLeads]);

  const reloadLeads = useCallback(async () => {
    try {
      const result = await fetchLeads();
      setLeads(result);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar los leads.');
    }
  }, [fetchLeads]);

  const refreshEventsForLead = useCallback(async (leadId: string) => {
    try {
      const events = await getLeadEvents(leadId);
      setEventsByLeadId((prev) => ({ ...prev, [leadId]: events }));
    } catch {
      // Keep whatever timeline was already shown — a secondary refresh
      // failing isn't worth surfacing over the row's main content.
    }
  }, []);

  // Scope filter — sits above search/stage. "Todos los clientes" (CLIENTES
  // scope, no client picked) must never include REKREATIVE's own leads;
  // this guarantees it regardless of what `leads` currently holds.
  const scopedLeads = useMemo(() => leads.filter((lead) => lead.scope === moduleScope), [leads, moduleScope]);

  // Search is client-side, UI-only state — never persisted, matches name,
  // email, phone, and campaign case-insensitively. Operates only within the
  // currently selected scope.
  const searchedLeads = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scopedLeads;
    return scopedLeads.filter(
      (lead) =>
        lead.name.toLowerCase().includes(q) ||
        (lead.email ?? '').toLowerCase().includes(q) ||
        (lead.phone ?? '').toLowerCase().includes(q) ||
        (lead.campaign ?? '').toLowerCase().includes(q),
    );
  }, [scopedLeads, query]);

  // Stage filter counts — computed from the already-loaded, search-filtered
  // leads (never a new metric/store); reacts live as the search narrows.
  const stageCounts = useMemo(() => {
    const counts: Record<'all' | LeadStage, number> = { all: searchedLeads.length } as Record<'all' | LeadStage, number>;
    for (const option of LEAD_STAGE_OPTIONS) {
      counts[option.id] = searchedLeads.filter((lead) => lead.stage === option.id).length;
    }
    return counts;
  }, [searchedLeads]);

  const visibleLeads = useMemo(
    () =>
      searchedLeads.filter((lead) => {
        if (stageFilter !== 'all' && lead.stage !== stageFilter) return false;
        return true;
      }),
    [searchedLeads, stageFilter],
  );

  // REKREATIVE scope: every row is already known to be internal, so the
  // Cliente column is redundant there — shown as-is in CLIENTES scope.
  const showClientColumn = moduleScope === 'client';
  const columnCount = showClientColumn ? 9 : 8;

  const openCreateForm = () => {
    const firstClient = moduleScope === 'client' ? clients[0]?.id ?? '' : '';
    setDraft(emptyDraft(firstClient));
    setEditingLeadId(null);
    setShowCreate(true);
  };

  const openEditForm = (lead: Lead) => {
    setEditingLeadId(lead.id);
    setDraft({
      clientId: lead.clientId ?? '',
      name: lead.name,
      email: lead.email ?? '',
      phone: lead.phone ?? '',
      whatsapp: lead.whatsapp ?? '',
      source: lead.source,
      campaign: lead.campaign ?? '',
      adCreative: lead.adCreative ?? '',
      form: lead.form ?? '',
      stage: lead.stage,
    });
    setShowCreate(true);
  };

  const closeForm = () => {
    setShowCreate(false);
    setEditingLeadId(null);
    setDraft(emptyDraft(clients[0]?.id ?? ''));
  };

  const submitLead = async () => {
    const scope: LeadScope = moduleScope;
    const clientId = scope === 'client' ? draft.clientId : null;
    const name = draft.name.trim();
    const email = draft.email.trim() || null;
    const phone = draft.phone.trim() || null;
    const whatsapp = draft.whatsapp.trim() || null;
    const source = draft.source.trim() || 'Manual';
    const campaign = draft.campaign.trim() || null;
    const adCreative = draft.adCreative.trim() || null;
    const form = draft.form.trim() || null;

    if (!name || (scope === 'client' && !clientId)) {
      return;
    }

    try {
      if (editingLeadId) {
        // Business fields only — scope/clientId can't be changed once a
        // lead exists (see lib/api/leads.ts's UpdateLeadInput); the create
        // form's client selector is disabled in edit mode for this reason.
        const existing = leads.find((lead) => lead.id === editingLeadId);
        await updateLead(editingLeadId, { name, email, phone, whatsapp, source, campaign, adCreative, form });
        if (existing && existing.stage !== draft.stage) {
          await setLeadStage(editingLeadId, draft.stage);
        }
      } else {
        await createLead({ scope, clientId, name, email, phone, whatsapp, source, campaign, adCreative, form, stage: draft.stage });
      }
      await reloadLeads();
      closeForm();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo guardar el lead.');
    }
  };

  const handleStageChange = async (leadId: string, nextStage: LeadStage) => {
    try {
      await setLeadStage(leadId, nextStage);
      await reloadLeads();
      await refreshEventsForLead(leadId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo cambiar la etapa.');
    }
  };

  const handleToggle = (leadId: string) => {
    // Refetch on every collapse→expand transition, not just the first time
    // a row is opened — a lead's timeline can gain events from outside this
    // page (Make-reported WhatsApp sends/deliveries/replies), so a cached
    // first fetch would otherwise go stale for the rest of the session.
    const opening = !expanded[leadId];
    setExpanded((prev) => ({ ...prev, [leadId]: !prev[leadId] }));
    if (opening && !eventsLoadingId[leadId]) {
      setEventsLoadingId((prev) => ({ ...prev, [leadId]: true }));
      getLeadEvents(leadId)
        .then((events) => setEventsByLeadId((prev) => ({ ...prev, [leadId]: events })))
        .catch(() => setEventsByLeadId((prev) => ({ ...prev, [leadId]: [] })))
        .finally(() => setEventsLoadingId((prev) => ({ ...prev, [leadId]: false })));
    }
  };

  const handleAddManualNote = (leadId: string) => {
    setNoteLeadId(leadId);
    setNoteDraft('');
  };

  const submitNote = async () => {
    if (!noteLeadId || !noteDraft.trim()) return;
    try {
      await appendLeadEvent(noteLeadId, { summary: noteDraft.trim() });
      await reloadLeads();
      await refreshEventsForLead(noteLeadId);
      setNoteLeadId(null);
      setNoteDraft('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo guardar la nota.');
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-os-dim">REKREATIVE CRM</div>
          <h1 className="mt-1 text-[25px] font-bold uppercase tracking-[0.06em] text-os-text">Leads</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCreateForm}
            className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
          >
            Nuevo lead
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">{loadError}</div>
      )}

      {/* Primary scope — REKREATIVE's own acquisition vs. client leads.
          Conceptually above every filter below; REKREATIVE is never a
          client, so this never touches the client selector's options. */}
      <div className="mb-4 flex items-center gap-1.5">
        {LEAD_SCOPE_OPTIONS.map((option) => {
          const active = moduleScope === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setModuleScope(option.id)}
              className={`border px-3 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide ${
                active ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-muted'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-os-dim" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar lead..."
            className="border border-os-border bg-os-surface py-1.5 pl-8 pr-2.5 text-[12.5px] text-os-text outline-none placeholder:text-os-dim focus:border-os-border-strong"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STAGE_FILTERS.map((option) => {
            const active = stageFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setStageFilter(option.id as 'all' | LeadStage)}
                className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${
                  active ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-muted'
                }`}
              >
                {option.label} <span className="opacity-70">{stageCounts[option.id as 'all' | LeadStage] ?? 0}</span>
              </button>
            );
          })}
        </div>

        {moduleScope === 'client' && (
          <div className="ml-auto flex items-center gap-2">
            <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Cliente</label>
            <select
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
            >
              <option value="all">Todos los clientes</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-sm-t border border-os-border bg-os-surface">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-os-surface2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
              <th className="px-3 py-2 font-normal">Lead</th>
              {showClientColumn && <th className="px-3 py-2 font-normal">Cliente</th>}
              <th className="px-3 py-2 font-normal">Etapa</th>
              <th className="px-3 py-2 font-normal">Intención IA</th>
              <th className="px-3 py-2 font-normal">Origen</th>
              <th className="px-3 py-2 font-normal">Campaña</th>
              <th className="px-3 py-2 font-normal">Última actividad</th>
              <th className="px-3 py-2 font-normal">Contacto</th>
              <th className="px-3 py-2 font-normal text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columnCount} className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
                  Cargando leads…
                </td>
              </tr>
            ) : visibleLeads.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
                  No hay leads que coincidan con estos filtros.
                </td>
              </tr>
            ) : (
              visibleLeads.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  clients={clients}
                  events={eventsByLeadId[lead.id] ?? []}
                  eventsLoading={Boolean(eventsLoadingId[lead.id])}
                  showClientColumn={showClientColumn}
                  columnCount={columnCount}
                  expanded={Boolean(expanded[lead.id])}
                  onToggle={() => handleToggle(lead.id)}
                  onStageChange={(nextStage) => handleStageChange(lead.id, nextStage)}
                  onEdit={() => openEditForm(lead)}
                  onAddNote={() => handleAddManualNote(lead.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-sm-t border border-os-border bg-os-surface p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide">{editingLeadId ? 'Editar lead' : 'Nuevo lead'}</h2>
              <button type="button" onClick={closeForm} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                cerrar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {moduleScope === 'client' ? (
                <label className="col-span-2">
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Cliente</span>
                  <select
                    value={draft.clientId}
                    disabled={Boolean(editingLeadId)}
                    onChange={(event) => setDraft((prev) => ({ ...prev, clientId: event.target.value }))}
                    className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                  {editingLeadId && (
                    <span className="mt-1 block font-mono text-[9px] text-os-dim">El cliente de un lead no se puede reasignar.</span>
                  )}
                </label>
              ) : (
                <label className="col-span-2">
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Cliente</span>
                  <input
                    disabled
                    value="Interno · REKREATIVE"
                    className="w-full cursor-not-allowed border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-dim"
                  />
                </label>
              )}

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Nombre</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Etapa</span>
                <select
                  value={draft.stage}
                  onChange={(event) => setDraft((prev) => ({ ...prev, stage: event.target.value as LeadStage }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  {LEAD_STAGE_OPTIONS.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Email</span>
                <input
                  value={draft.email}
                  onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Teléfono</span>
                <input
                  value={draft.phone}
                  onChange={(event) => setDraft((prev) => ({ ...prev, phone: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">WhatsApp</span>
                <input
                  value={draft.whatsapp}
                  onChange={(event) => setDraft((prev) => ({ ...prev, whatsapp: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Origen</span>
                <input
                  value={draft.source}
                  onChange={(event) => setDraft((prev) => ({ ...prev, source: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Campaña</span>
                <input
                  value={draft.campaign}
                  onChange={(event) => setDraft((prev) => ({ ...prev, campaign: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Creatividad del anuncio</span>
                <input
                  value={draft.adCreative}
                  onChange={(event) => setDraft((prev) => ({ ...prev, adCreative: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Formulario</span>
                <input
                  value={draft.form}
                  onChange={(event) => setDraft((prev) => ({ ...prev, form: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Cancelar
              </button>
              <button type="button" onClick={submitLead} className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface">
                {editingLeadId ? 'Guardar lead' : 'Crear lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {noteLeadId && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-sm-t border border-os-border bg-os-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide">Añadir nota manual</h3>
              <button type="button" onClick={() => setNoteLeadId(null)} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                cerrar
              </button>
            </div>
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              rows={4}
              className="w-full border border-os-border bg-os-surface2 p-2 text-sm text-os-text outline-none"
              placeholder="Añade una breve nota sobre el lead..."
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setNoteLeadId(null)} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Cancelar
              </button>
              <button type="button" onClick={submitNote} className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface">
                Guardar nota
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

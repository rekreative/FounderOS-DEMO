'use client';

import { useEffect, useMemo, useState } from 'react';
import { getClients, initializeStoreIfNeeded } from '@/lib/clients';
import {
  LEAD_STAGE_OPTIONS,
  appendLeadEvent,
  createLead,
  getClientNameForLead,
  getLeadEvents,
  getLeads,
  initializeLeadsStoreIfNeeded,
  setLeadStage,
  updateLead,
  type Lead,
  type LeadEvent,
  type LeadStage,
} from '@/lib/leads';

const STAGE_FILTERS = [{ id: 'all', label: 'All' }, ...LEAD_STAGE_OPTIONS];

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
  return date.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatRelative(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffHours = Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
  if (diffHours < 24) {
    return `${Math.max(1, Math.round(diffHours))}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function eventLabel(type: LeadEvent['type']): string {
  const map: Record<LeadEvent['type'], string> = {
    lead_received: 'Lead received',
    ai_analyzed: 'AI analyzed',
    whatsapp_sent: 'WhatsApp sent',
    whatsapp_delivered: 'WhatsApp delivered',
    lead_replied: 'Lead replied',
    commercial_contacted: 'Commercial contacted',
    appointment_booked: 'Appointment booked',
    appointment_completed: 'Appointment completed',
    converted: 'Converted',
    disqualified: 'Disqualified',
    manual_note: 'Manual note',
    stage_changed: 'Stage changed',
  };
  return map[type] ?? type;
}

function LeadRow({
  lead,
  events,
  expanded,
  onToggle,
  onStageChange,
  onEdit,
  onAddNote,
}: {
  lead: Lead;
  events: LeadEvent[];
  expanded: boolean;
  onToggle: () => void;
  onStageChange: (nextStage: LeadStage) => void;
  onEdit: () => void;
  onAddNote: () => void;
}) {
  const clientName = getClientNameForLead(lead.clientId);
  const aiIntent = lead.aiAnalysis?.intent ? lead.aiAnalysis.intent.toUpperCase() : '—';

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
                <div className="mt-0.5 text-[10px] text-os-dim">{lead.email || lead.phone || lead.whatsapp || 'No contact yet'}</div>
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{clientName}</td>
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
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-os-dim">
            {lead.email && <span className="font-mono">email</span>}
            {lead.phone && <span className="font-mono">phone</span>}
            {lead.whatsapp && <span className="font-mono">wa</span>}
            {!lead.email && !lead.phone && !lead.whatsapp && <span className="font-mono">—</span>}
          </div>
        </td>
        <td className="px-3 py-3 text-right">
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onAddNote} className="font-mono text-[9px] uppercase tracking-wide text-os-dim hover:text-os-accent">
              add note
            </button>
            <button type="button" onClick={onEdit} className="font-mono text-[9px] uppercase tracking-wide text-os-muted hover:text-os-accent">
              edit
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="border-t border-os-border bg-os-surface px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Relationship timeline</span>
              <span className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">{events.length} events</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {events.length === 0 ? (
                <span className="font-mono text-[10px] text-os-dim">No timeline events yet.</span>
              ) : (
                events.map((event, index) => (
                  <span key={event.id} className="inline-flex items-center gap-1.5 rounded-sm-t border border-os-border bg-os-surface2 px-2 py-1">
                    {index > 0 && <span className="font-mono text-[9px] text-os-dim">→</span>}
                    <span className="font-mono text-[9.5px] uppercase tracking-wide text-os-muted">{eventLabel(event.type)}</span>
                    <span className="font-mono text-[8.5px] text-os-dim">{formatDateTime(event.occurredAt)}</span>
                  </span>
                ))
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function LeadsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stageFilter, setStageFilter] = useState<'all' | LeadStage>('all');
  const [clientFilter, setClientFilter] = useState<'all' | string>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [noteLeadId, setNoteLeadId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [draft, setDraft] = useState<DraftLead>(emptyDraft());

  const loadLeads = () => {
    const activeClient = clientFilter === 'all' ? undefined : clientFilter;
    setLeads(getLeads(activeClient));
  };

  useEffect(() => {
    initializeStoreIfNeeded();
    initializeLeadsStoreIfNeeded();
    setClients(getClients());
    setLeads(getLeads());
  }, []);

  useEffect(() => {
    loadLeads();
  }, [clientFilter]);

  const visibleLeads = useMemo(
    () =>
      leads.filter((lead) => {
        if (stageFilter !== 'all' && lead.stage !== stageFilter) return false;
        return true;
      }),
    [leads, stageFilter],
  );

  const openCreateForm = () => {
    const firstClient = clients[0]?.id ?? '';
    setDraft(emptyDraft(firstClient));
    setEditingLeadId(null);
    setShowCreate(true);
  };

  const openEditForm = (lead: Lead) => {
    setEditingLeadId(lead.id);
    setDraft({
      clientId: lead.clientId,
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

  const submitLead = () => {
    const normalized = {
      clientId: draft.clientId,
      name: draft.name.trim(),
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      whatsapp: draft.whatsapp.trim() || null,
      source: draft.source.trim() || 'Manual',
      campaign: draft.campaign.trim() || null,
      adCreative: draft.adCreative.trim() || null,
      form: draft.form.trim() || null,
      stage: draft.stage,
    };

    if (!normalized.name || !normalized.clientId) {
      return;
    }

    if (editingLeadId) {
      const existing = leads.find((lead) => lead.id === editingLeadId);
      const next = updateLead(editingLeadId, {
        clientId: normalized.clientId,
        name: normalized.name,
        email: normalized.email,
        phone: normalized.phone,
        whatsapp: normalized.whatsapp,
        source: normalized.source,
        campaign: normalized.campaign,
        adCreative: normalized.adCreative,
        form: normalized.form,
        lastActivityAt: new Date().toISOString(),
      });

      if (existing && existing.stage !== normalized.stage) {
        setLeadStage(editingLeadId, normalized.stage, 'manual');
      }

      if (next) {
        const activeClient = clientFilter === 'all' ? undefined : clientFilter;
        setLeads(getLeads(activeClient));
      }
    } else {
      createLead(normalized);
      const activeClient = clientFilter === 'all' ? undefined : clientFilter;
      setLeads(getLeads(activeClient));
    }

    closeForm();
  };

  const handleStageChange = (leadId: string, nextStage: LeadStage) => {
    setLeadStage(leadId, nextStage, 'manual');
    const activeClient = clientFilter === 'all' ? undefined : clientFilter;
    setLeads(getLeads(activeClient));
  };

  const handleAddManualNote = (leadId: string) => {
    setNoteLeadId(leadId);
    setNoteDraft('');
  };

  const submitNote = () => {
    if (!noteLeadId || !noteDraft.trim()) return;
    appendLeadEvent(noteLeadId, {
      type: 'manual_note',
      source: 'manual',
      summary: noteDraft.trim(),
      occurredAt: new Date().toISOString(),
    });
    const activeClient = clientFilter === 'all' ? undefined : clientFilter;
    setLeads(getLeads(activeClient));
    setNoteLeadId(null);
    setNoteDraft('');
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
            New lead
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
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
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Client</label>
          <select
            value={clientFilter}
            onChange={(event) => setClientFilter(event.target.value)}
            className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
          >
            <option value="all">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-sm-t border border-os-border bg-os-surface">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="bg-os-surface2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">
              <th className="px-3 py-2 font-normal">Lead</th>
              <th className="px-3 py-2 font-normal">Client</th>
              <th className="px-3 py-2 font-normal">Stage</th>
              <th className="px-3 py-2 font-normal">AI intent</th>
              <th className="px-3 py-2 font-normal">Source</th>
              <th className="px-3 py-2 font-normal">Campaign</th>
              <th className="px-3 py-2 font-normal">Last activity</th>
              <th className="px-3 py-2 font-normal">Contact</th>
              <th className="px-3 py-2 font-normal text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleLeads.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
                  No leads in this segment.
                </td>
              </tr>
            ) : (
              visibleLeads.map((lead) => (
                <LeadRow
                  key={lead.id}
                  lead={lead}
                  events={getLeadEvents(lead.id)}
                  expanded={Boolean(expanded[lead.id])}
                  onToggle={() => setExpanded((prev) => ({ ...prev, [lead.id]: !prev[lead.id] }))}
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
              <h2 className="text-lg font-semibold uppercase tracking-wide">{editingLeadId ? 'Edit lead' : 'New lead'}</h2>
              <button type="button" onClick={closeForm} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Client</span>
                <select
                  value={draft.clientId}
                  onChange={(event) => setDraft((prev) => ({ ...prev, clientId: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Name</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Stage</span>
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
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Phone</span>
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
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Source</span>
                <input
                  value={draft.source}
                  onChange={(event) => setDraft((prev) => ({ ...prev, source: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Campaign</span>
                <input
                  value={draft.campaign}
                  onChange={(event) => setDraft((prev) => ({ ...prev, campaign: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Ad creative</span>
                <input
                  value={draft.adCreative}
                  onChange={(event) => setDraft((prev) => ({ ...prev, adCreative: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Form</span>
                <input
                  value={draft.form}
                  onChange={(event) => setDraft((prev) => ({ ...prev, form: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Cancel
              </button>
              <button type="button" onClick={submitLead} className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface">
                {editingLeadId ? 'Save lead' : 'Create lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {noteLeadId && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-sm-t border border-os-border bg-os-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide">Add manual note</h3>
              <button type="button" onClick={() => setNoteLeadId(null)} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                close
              </button>
            </div>
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              rows={4}
              className="w-full border border-os-border bg-os-surface2 p-2 text-sm text-os-text outline-none"
              placeholder="Add a brief note about the lead..."
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setNoteLeadId(null)} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Cancel
              </button>
              <button type="button" onClick={submitNote} className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface">
                Save note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

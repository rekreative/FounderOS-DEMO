'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useClientsRegistry } from '@/components/ClientsProvider';
import { getInternalBusinessWorkspace } from '@/lib/api/business';
import type { InternalBusinessService } from '@/lib/business';
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
  appendCommercialEvent,
  appendLeadEvent,
  createLead,
  getLeadMetaCapiDeliveries,
  getLeadEvents,
  getLeads,
  recordLeadPayment,
  sendLeadMetaCapiTestEvent,
  setLeadStage,
  updateLead,
  type CommercialEventType,
  type ConversionPaymentPlan,
  type Lead,
  type LeadMetaCapiDelivery,
  type LeadEvent,
  type MetaCapiEventKind,
} from '@/lib/api/leads';

const STAGE_FILTERS = [{ id: 'all', label: 'Todos' }, ...LEAD_STAGE_OPTIONS];

const STAGE_VISUAL: Record<LeadStage, { border: string; badge: string; dot: string }> = {
  new: { border: 'border-l-[var(--funnel-s0)]', badge: 'border-[var(--funnel-s0)] text-os-text', dot: 'bg-[var(--funnel-s0)]' },
  contacted: { border: 'border-l-[var(--funnel-s1)]', badge: 'border-[var(--funnel-s1)] text-os-text', dot: 'bg-[var(--funnel-s1)]' },
  qualified: { border: 'border-l-[var(--funnel-s2)]', badge: 'border-[var(--funnel-s2)] text-os-text', dot: 'bg-[var(--funnel-s2)]' },
  appointment: { border: 'border-l-[var(--funnel-s3)]', badge: 'border-[var(--funnel-s3)] text-os-text', dot: 'bg-[var(--funnel-s3)]' },
  proposal_sent: { border: 'border-l-[var(--lead-proposal)]', badge: 'border-[var(--lead-proposal)] text-os-text', dot: 'bg-[var(--lead-proposal)]' },
  converted: { border: 'border-l-os-ok', badge: 'border-os-ok text-os-ok', dot: 'bg-os-ok' },
  no_response: { border: 'border-l-os-warn', badge: 'border-os-warn text-os-warn', dot: 'bg-os-warn' },
  disqualified: { border: 'border-l-os-err', badge: 'border-os-err text-os-err', dot: 'bg-os-err' },
};

function WhatsAppStatusBadge({ lead }: { lead: Lead }) {
  if (lead.phoneQuality?.status === 'invalid') {
    return <span className="border border-os-err bg-os-err/10 px-1.5 py-0.5 font-mono text-[8.5px] uppercase text-os-err">Teléfono inválido</span>;
  }
  const labels = {
    not_sent: { text: 'Sin envío', className: 'border-os-border text-os-dim' },
    accepted: { text: 'WA aceptado', className: 'border-os-warn bg-os-warn/10 text-os-warn' },
    delivered: { text: 'WA entregado', className: 'border-os-ok bg-os-ok/10 text-os-ok' },
    replied: { text: 'Respondió', className: 'border-os-ok bg-os-ok/10 text-os-ok' },
    failed: { text: 'WA no enviado', className: 'border-os-err bg-os-err/10 text-os-err' },
  } as const;
  const display = labels[lead.whatsappStatus?.state ?? 'not_sent'];
  return <span className={`border px-1.5 py-0.5 font-mono text-[8.5px] uppercase ${display.className}`}>{display.text}</span>;
}

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
  /** datetime-local input value ("YYYY-MM-DDTHH:mm"), or '' when unset. */
  appointmentDate: string;
  /** Raw numeric-string input, or '' when unset. */
  conversionValue: string;
};

type ConversionPayload = {
  conversionValue: number;
  serviceId: string;
  paymentPlan: ConversionPaymentPlan;
  initialPayment: number;
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
  appointmentDate: '',
  conversionValue: '',
});

/** ISO datetime → the "YYYY-MM-DDTHH:mm" shape <input type="datetime-local">
 *  needs. Null/unparseable → ''. */
function toDatetimeLocalValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** <input type="datetime-local"> value → ISO, or null when empty/unparseable. */
function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

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
    whatsapp_failed: 'WhatsApp no enviado',
    lead_replied: 'Lead respondió',
    commercial_contacted: 'Contacto comercial',
    proposal_sent: 'Propuesta enviada',
    qualified: 'Cualificado',
    appointment_booked: 'Cita reservada',
    appointment_completed: 'Cita completada',
    converted: 'Convertido',
    payment_received: 'Cobro registrado',
    meta_capi_test: 'Meta CAPI',
    disqualified: 'Descartado',
    manual_note: 'Nota manual',
    stage_changed: 'Etapa cambiada',
  };
  return map[type] ?? type;
}

function CommercialFinancePanel({
  lead,
  onRecordPayment,
}: {
  lead: Lead;
  onRecordPayment: (input: { amount: number; occurredAt: string; notes?: string | null }) => Promise<void>;
}) {
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => toDatetimeLocalValue(new Date().toISOString()));
  const [savingPayment, setSavingPayment] = useState(false);

  if (!lead.conversionSnapshot || lead.conversionValue == null || !lead.conversionCollection) return null;
  const collection = lead.conversionCollection;
  const isMonthly = lead.conversionSnapshot.billingType === 'monthly';

  return (
    <div className="mt-3 border border-os-border bg-os-surface2 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><div className="font-mono text-[9px] uppercase tracking-wide text-os-dim">Servicio contratado</div><div className="mt-1 text-[11px] text-os-text">{lead.conversionSnapshot.serviceName}</div></div>
        <div><div className="font-mono text-[9px] uppercase tracking-wide text-os-dim">Valor acordado</div><div className="mt-1 text-[11px] text-os-text">{lead.conversionValue.toLocaleString('es-ES')} €</div></div>
        <div><div className="font-mono text-[9px] uppercase tracking-wide text-os-dim">Dinero cobrado</div><div className="mt-1 text-[11px] text-os-ok">{collection.totalCollected.toLocaleString('es-ES')} €</div></div>
        <div><div className="font-mono text-[9px] uppercase tracking-wide text-os-dim">{isMonthly ? 'Estado mensual' : 'Importe pendiente'}</div><div className="mt-1 text-[11px] text-os-text">{isMonthly ? (collection.status === 'active' ? 'Activo' : 'Pendiente') : `${(collection.outstandingAmount ?? 0).toLocaleString('es-ES')} €`}</div></div>
      </div>
      <div className="mt-3 flex justify-end border-t border-os-border pt-3">
        <button type="button" onClick={() => setShowPaymentForm((current) => !current)} className="border border-os-ok px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-ok hover:bg-os-ok/10">
          Registrar cobro
        </button>
      </div>
      {showPaymentForm && (
        <div className="mt-3 grid grid-cols-1 gap-2 border-t border-os-border pt-3 sm:grid-cols-3">
          <label><span className="font-mono text-[8.5px] uppercase text-os-dim">Importe cobrado</span><input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full border border-os-border bg-os-surface px-2 py-1.5 text-[11px] text-os-text" /></label>
          <label><span className="font-mono text-[8.5px] uppercase text-os-dim">Fecha de cobro</span><input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} className="mt-1 w-full border border-os-border bg-os-surface px-2 py-1.5 text-[11px] text-os-text" /></label>
          <label><span className="font-mono text-[8.5px] uppercase text-os-dim">Nota</span><input type="text" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Opcional" className="mt-1 w-full border border-os-border bg-os-surface px-2 py-1.5 text-[11px] text-os-text placeholder:text-os-dim" /></label>
          <div className="sm:col-span-3 flex justify-end gap-2"><button type="button" disabled={savingPayment} onClick={() => setShowPaymentForm(false)} className="border border-os-border px-2 py-1 font-mono text-[9px] uppercase text-os-muted disabled:opacity-40">Cancelar</button><button type="button" disabled={savingPayment} onClick={async () => { const parsedAmount = Number(amount); const date = fromDatetimeLocalValue(occurredAt); if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !date) return; setSavingPayment(true); try { await onRecordPayment({ amount: parsedAmount, occurredAt: date, notes: notes.trim() || null }); setAmount(''); setNotes(''); setShowPaymentForm(false); } catch { /* The parent exposes the user-safe error banner. */ } finally { setSavingPayment(false); } }} className="border border-os-accent bg-os-accent px-2 py-1 font-mono text-[9px] uppercase text-os-bg disabled:opacity-40">{savingPayment ? 'Guardando…' : 'Guardar cobro'}</button></div>
        </div>
      )}
    </div>
  );
}

const META_CAPI_KIND_LABEL: Record<MetaCapiEventKind, string> = {
  qualified_lead: 'Lead cualificado',
  appointment: 'Cita',
  converted: 'Conversión',
};

function MetaCapiTestPanel({
  lead,
  deliveries,
  loading,
  onSend,
}: {
  lead: Lead;
  deliveries: LeadMetaCapiDelivery[];
  loading: boolean;
  onSend: (input: { kind: MetaCapiEventKind; testEventCode: string }) => Promise<void>;
}) {
  const allowedKinds = useMemo<MetaCapiEventKind[]>(() => {
    if (lead.scope !== 'internal') return [];
    if (lead.stage === 'converted') return ['qualified_lead', 'appointment', 'converted'];
    if (lead.stage === 'appointment' || lead.stage === 'proposal_sent') return ['qualified_lead', 'appointment'];
    if (lead.stage === 'qualified') return ['qualified_lead'];
    return [];
  }, [lead.scope, lead.stage]);
  const [kind, setKind] = useState<MetaCapiEventKind>('qualified_lead');
  const [testEventCode, setTestEventCode] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!allowedKinds.includes(kind)) setKind(allowedKinds[0] ?? 'qualified_lead');
  }, [allowedKinds, kind]);

  if (lead.scope !== 'internal' || allowedKinds.length === 0) return null;
  const selectedDelivery = deliveries.find((delivery) => delivery.eventKind === kind);
  const isAccepted = selectedDelivery?.status === 'accepted';
  const statusStyle =
    selectedDelivery?.status === 'accepted'
      ? 'border-os-ok bg-os-ok/10 text-os-ok'
      : selectedDelivery?.status === 'failed'
        ? 'border-os-err bg-os-err/10 text-os-err'
        : 'border-os-warn bg-os-warn/10 text-os-warn';
  const statusLabel =
    selectedDelivery?.status === 'accepted' ? 'Aceptada por Meta' : selectedDelivery?.status === 'failed' ? 'Error' : 'Pendiente';

  return (
    <section className="mt-3 border border-os-border bg-os-surface2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">Meta CAPI</div>
          <p className="mt-1 text-[10.5px] text-os-muted">Prueba controlada. No cambia la etapa ni envía eventos reales de campaña.</p>
        </div>
        {selectedDelivery && (
          <span className={`border px-1.5 py-0.5 font-mono text-[8.5px] uppercase ${statusStyle}`}>{statusLabel}</span>
        )}
      </div>
      {loading ? (
        <div className="mt-3 font-mono text-[10px] text-os-dim">Cargando estado CAPI…</div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
          <label className="block"><span className="font-mono text-[8.5px] uppercase text-os-dim">Señal CRM</span><select value={kind} onChange={(event) => setKind(event.target.value as MetaCapiEventKind)} className="mt-1 w-full border border-os-border bg-os-surface px-2 py-1.5 text-[11px] text-os-text">{allowedKinds.map((item) => <option key={item} value={item}>{META_CAPI_KIND_LABEL[item]}</option>)}</select></label>
          <label className="block"><span className="font-mono text-[8.5px] uppercase text-os-dim">Código de prueba de Meta</span><input type="text" value={testEventCode} onChange={(event) => setTestEventCode(event.target.value)} placeholder="Pegar solo para esta prueba" disabled={isAccepted || saving} className="mt-1 w-full border border-os-border bg-os-surface px-2 py-1.5 text-[11px] text-os-text placeholder:text-os-dim disabled:opacity-50" /></label>
          <button type="button" disabled={!testEventCode.trim() || isAccepted || saving} onClick={async () => { setSaving(true); try { await onSend({ kind, testEventCode: testEventCode.trim() }); setTestEventCode(''); } finally { setSaving(false); } }} className="border border-os-accent bg-os-accent px-2 py-1.5 font-mono text-[9px] uppercase text-os-bg disabled:cursor-not-allowed disabled:opacity-40">{isAccepted ? 'Ya aceptada' : saving ? 'Enviando…' : 'Enviar prueba'}</button>
        </div>
      )}
      {selectedDelivery?.status === 'failed' && <p className="mt-2 font-mono text-[9px] text-os-err">Meta no aceptó esta prueba. Revisa el código de prueba o los datos de contacto y vuelve a intentarlo.</p>}
      {selectedDelivery && <p className="mt-2 font-mono text-[8.5px] text-os-dim">Último intento: {formatDateTime(selectedDelivery.lastAttemptedAt)} · {selectedDelivery.attemptCount} intento{selectedDelivery.attemptCount === 1 ? '' : 's'}</p>}
    </section>
  );
}

function LeadMobileCard({
  lead,
  clients,
  services,
  events,
  eventsLoading,
  capiDeliveries,
  capiLoading,
  showClient,
  expanded,
  onToggle,
  onStageChange,
  onEdit,
  onAddNote,
  onCommercialEvent,
  onRecordPayment,
  onSendMetaCapiTest,
}: {
  lead: Lead;
  clients: { id: string; name: string }[];
  services: InternalBusinessService[];
  events: LeadEvent[];
  eventsLoading: boolean;
  capiDeliveries: LeadMetaCapiDelivery[];
  capiLoading: boolean;
  showClient: boolean;
  expanded: boolean;
  onToggle: () => void;
  onStageChange: (nextStage: LeadStage) => void;
  onEdit: () => void;
  onAddNote: () => void;
  onCommercialEvent: (type: CommercialEventType, payload?: ConversionPayload) => void;
  onRecordPayment: (input: { amount: number; occurredAt: string; notes?: string | null }) => Promise<void>;
  onSendMetaCapiTest: (input: { kind: MetaCapiEventKind; testEventCode: string }) => Promise<void>;
}) {
  const clientName = getClientNameForLead(lead.clientId, clients);
  const aiIntent = lead.aiAnalysis?.intent ? AI_INTENT_LABEL[lead.aiAnalysis.intent] : '—';
  const isTerminal = lead.stage === 'converted' || lead.stage === 'disqualified';
  const canQualify = lead.stage === 'new' || lead.stage === 'contacted' || lead.stage === 'no_response';
  const [showConversion, setShowConversion] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [agreedValue, setAgreedValue] = useState('');
  const [initialPayment, setInitialPayment] = useState('0');
  const [paymentPlan, setPaymentPlan] = useState<ConversionPaymentPlan>('full');
  const selectedService = services.find((service) => service.id === serviceId) ?? null;

  const openConversion = () => {
    const service = services.find((item) => item.id === lead.conversionSnapshot?.serviceId) ?? services[0];
    if (!service) return;
    setServiceId(service.id);
    setAgreedValue(String(lead.conversionValue ?? service.price));
    setInitialPayment(String(lead.conversionSnapshot?.initialPayment ?? 0));
    setPaymentPlan(lead.conversionSnapshot?.paymentPlan ?? (service.billingType === 'monthly' ? 'monthly' : service.allowTwoPayments ? 'two_payments' : 'full'));
    setShowConversion(true);
  };

  return (
    <article className={`min-w-0 border border-l-4 border-os-border bg-os-surface p-4 ${STAGE_VISUAL[lead.stage].border}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <span className="flex items-center gap-2 break-words text-[14px] font-semibold text-os-text">
            <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_VISUAL[lead.stage].dot}`} />
            {lead.name}
          </span>
          <span className="mt-1 block space-y-0.5 font-mono text-[10px] text-os-dim">
            {lead.email && <span className="block break-all">{lead.email}</span>}
            {(lead.phone || lead.whatsapp) && <span className="block break-all">{lead.phone || lead.whatsapp}</span>}
            {!lead.email && !lead.phone && !lead.whatsapp && <span className="block">Sin contacto</span>}
          </span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? 'Cerrar detalles del lead' : 'Abrir detalles del lead'}
          className="shrink-0 border border-os-border px-2 py-1 font-mono text-[10px] text-os-dim"
        >
          {expanded ? '−' : '+'}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={`border px-1.5 py-0.5 font-mono text-[8.5px] uppercase ${STAGE_VISUAL[lead.stage].badge}`}>
          {LEAD_STAGE_OPTIONS.find((stage) => stage.id === lead.stage)?.label ?? lead.stage}
        </span>
        <WhatsAppStatusBadge lead={lead} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-os-border pt-3">
        {showClient && (
          <div className="min-w-0">
            <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Cliente</div>
            <div className="mt-1 break-words text-[11px] text-os-muted">{clientName}</div>
          </div>
        )}
        <label className="min-w-0">
          <span className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Etapa</span>
          <select
            value={lead.stage}
            onChange={(event) => onStageChange(event.target.value as LeadStage)}
            disabled={isTerminal}
            className="mt-1 w-full min-w-0 border border-os-border bg-os-surface2 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text outline-none"
          >
            {LEAD_STAGE_OPTIONS.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
          </select>
        </label>
        <div className="min-w-0">
          <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Intención IA</div>
          <div className="mt-1 break-words font-mono text-[11px] text-os-muted">{aiIntent}</div>
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Origen</div>
          <div className="mt-1 break-words font-mono text-[11px] text-os-muted">{lead.source || '—'}</div>
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Campaña</div>
          <div className="mt-1 break-words font-mono text-[11px] text-os-muted">{lead.campaign || '—'}</div>
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Última actividad</div>
          <div className="mt-1 break-words font-mono text-[11px] text-os-dim">{formatRelative(lead.lastActivityAt)}</div>
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Contacto</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {lead.email && <span className="border border-os-border px-1.5 py-0.5 font-mono text-[8.5px] text-os-dim">EMAIL</span>}
            {lead.phone && <span className="border border-os-border px-1.5 py-0.5 font-mono text-[8.5px] text-os-dim">TEL</span>}
            {lead.whatsapp && <span className="border border-os-border px-1.5 py-0.5 font-mono text-[8.5px] text-os-dim">WA</span>}
            {!lead.email && !lead.phone && !lead.whatsapp && <span className="font-mono text-[10px] text-os-dim">—</span>}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 min-w-0 space-y-3 border-t border-os-border pt-3">
          {lead.aiAnalysis?.summary && (
            <div>
              <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Resumen IA</div>
              <div className="mt-1 whitespace-pre-wrap break-words text-[11px] text-os-muted">{lead.aiAnalysis.summary}</div>
            </div>
          )}
          <div>
            <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Actividad</div>
            <div className="mt-2 space-y-1.5">
              {eventsLoading ? (
                <div className="font-mono text-[10px] text-os-dim">Cargando actividad...</div>
              ) : events.length === 0 ? (
                <div className="font-mono text-[10px] text-os-dim">Sin eventos registrados.</div>
              ) : events.slice(-5).reverse().map((event) => (
                <div key={event.id} className="flex min-w-0 items-start justify-between gap-3 border border-os-border bg-os-surface2 px-2 py-1.5">
                  <span className="min-w-0">
                    <span className="block break-words font-mono text-[9.5px] text-os-muted">{eventLabel(event.type)}</span>
                    {event.type === 'manual_note' && (
                      <span className="mt-1 block whitespace-pre-wrap break-words text-[11px] leading-relaxed text-os-text">{event.summary}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-[8.5px] text-os-dim">{formatDateTime(event.occurredAt)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {expanded && <MetaCapiTestPanel lead={lead} deliveries={capiDeliveries} loading={capiLoading} onSend={onSendMetaCapiTest} />}
      <CommercialFinancePanel lead={lead} onRecordPayment={onRecordPayment} />

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-os-border pt-3">
        <button type="button" disabled={!canQualify} onClick={() => onCommercialEvent('qualified')} className="border border-os-border px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-os-muted disabled:cursor-not-allowed disabled:opacity-40">Cualificar</button>
        <button type="button" disabled={isTerminal} onClick={() => onCommercialEvent('disqualified')} className="border border-os-border px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-os-muted disabled:cursor-not-allowed disabled:opacity-40">No cualificado</button>
        <button type="button" disabled={isTerminal || lead.stage === 'proposal_sent'} onClick={() => onCommercialEvent('proposal_sent')} className="border border-os-border px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-os-muted disabled:opacity-40">Propuesta enviada</button>
        <button type="button" disabled={services.length === 0 || lead.stage === 'disqualified'} onClick={openConversion} className="border border-os-border px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-os-muted disabled:opacity-40">{lead.conversionSnapshot ? 'Editar conversión' : 'Registrar conversión'}</button>
        <button type="button" onClick={onAddNote} className="border border-os-border px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Notas</button>
        <button type="button" onClick={onEdit} className="border border-os-border px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-os-muted">Editar</button>
      </div>

      {showConversion && selectedService && (
        <div className="mt-3 space-y-3 border border-os-border bg-os-surface2 p-3">
          <label className="block"><span className="font-mono text-[8.5px] uppercase text-os-dim">Servicio contratado</span><select value={serviceId} onChange={(event) => { const service = services.find((item) => item.id === event.target.value); if (!service) return; setServiceId(service.id); setAgreedValue(String(service.price)); setPaymentPlan(service.billingType === 'monthly' ? 'monthly' : service.allowTwoPayments ? 'two_payments' : 'full'); }} className="mt-1 w-full border border-os-border bg-os-surface px-2 py-2 text-[12px] text-os-text">{services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.price.toLocaleString('es-ES')} €</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><label><span className="font-mono text-[8.5px] uppercase text-os-dim">Valor acordado</span><input type="number" min="0" step="0.01" value={agreedValue} onChange={(event) => setAgreedValue(event.target.value)} className="mt-1 w-full border border-os-border bg-os-surface px-2 py-2 text-[12px] text-os-text" /></label><label><span className="font-mono text-[8.5px] uppercase text-os-dim">Cobrado inicialmente</span><input type="number" min="0" step="0.01" value={initialPayment} disabled={lead.conversionSnapshot !== null} onChange={(event) => setInitialPayment(event.target.value)} className="mt-1 w-full border border-os-border bg-os-surface px-2 py-2 text-[12px] text-os-text disabled:opacity-50" /></label></div>
          <label className="block"><span className="font-mono text-[8.5px] uppercase text-os-dim">Modalidad</span><select value={paymentPlan} onChange={(event) => setPaymentPlan(event.target.value as ConversionPaymentPlan)} className="mt-1 w-full border border-os-border bg-os-surface px-2 py-2 text-[12px] text-os-text">{selectedService.billingType === 'one_off' && <option value="full">Pago completo</option>}{selectedService.allowTwoPayments && <option value="two_payments">Dos pagos</option>}{selectedService.billingType === 'monthly' && <option value="monthly">Mensual</option>}<option value="custom">Personalizado</option></select></label>
          <div className="flex items-center justify-between"><span className="font-mono text-[9px] uppercase text-os-dim">Importe pendiente</span><span className="text-sm text-os-text">{Math.max(0, Number(agreedValue || 0) - Number(initialPayment || 0)).toLocaleString('es-ES')} €</span></div>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowConversion(false)} className="border border-os-border px-2 py-1.5 font-mono text-[9px] uppercase text-os-muted">Cancelar</button><button type="button" onClick={() => { const value = Number(agreedValue); const paid = Number(initialPayment); if (!Number.isFinite(value) || !Number.isFinite(paid) || value < 0 || paid < 0 || paid > value) return; onCommercialEvent('converted', { conversionValue: value, serviceId, paymentPlan, initialPayment: paid }); setShowConversion(false); }} className="border border-os-accent bg-os-accent px-2 py-1.5 font-mono text-[9px] uppercase text-os-bg">Confirmar</button></div>
        </div>
      )}
    </article>
  );
}

function LeadRow({
  lead,
  clients,
  services,
  events,
  eventsLoading,
  capiDeliveries,
  capiLoading,
  showClientColumn,
  columnCount,
  expanded,
  onToggle,
  onStageChange,
  onEdit,
  onAddNote,
  onCommercialEvent,
  onRecordPayment,
  onSendMetaCapiTest,
}: {
  lead: Lead;
  clients: { id: string; name: string }[];
  services: InternalBusinessService[];
  events: LeadEvent[];
  eventsLoading: boolean;
  capiDeliveries: LeadMetaCapiDelivery[];
  capiLoading: boolean;
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
  onCommercialEvent: (type: CommercialEventType, payload?: { appointmentDate?: string } | ConversionPayload) => void;
  onRecordPayment: (input: { amount: number; occurredAt: string; notes?: string | null }) => Promise<void>;
  onSendMetaCapiTest: (input: { kind: MetaCapiEventKind; testEventCode: string }) => Promise<void>;
}) {
  const clientName = getClientNameForLead(lead.clientId, clients);
  const aiIntent = lead.aiAnalysis?.intent ? AI_INTENT_LABEL[lead.aiAnalysis.intent] : '—';
  const isTerminal = lead.stage === 'converted' || lead.stage === 'disqualified';
  const canQualify = lead.stage === 'new' || lead.stage === 'contacted' || lead.stage === 'no_response';

  // Quick-action drafts — local, ephemeral UI state scoped to this row, same
  // shape as the "Añadir nota" draft one level up. Re-synced whenever the
  // lead's own stored value changes (e.g. after a successful booking), so a
  // collapsed/reopened row always starts from the lead's real current state.
  const [appointmentDraft, setAppointmentDraft] = useState(() => toDatetimeLocalValue(lead.appointmentDate));
  const [showConversion, setShowConversion] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [agreedValue, setAgreedValue] = useState('');
  const [initialPayment, setInitialPayment] = useState('0');
  const [paymentPlan, setPaymentPlan] = useState<ConversionPaymentPlan>('full');
  useEffect(() => setAppointmentDraft(toDatetimeLocalValue(lead.appointmentDate)), [lead.appointmentDate]);

  const selectedService = services.find((service) => service.id === serviceId) ?? null;
  const openConversion = () => {
    const service = services.find((item) => item.id === lead.conversionSnapshot?.serviceId) ?? services[0];
    if (!service) return;
    setServiceId(service.id);
    setAgreedValue(String(lead.conversionValue ?? service.price));
    setInitialPayment(String(lead.conversionSnapshot?.initialPayment ?? 0));
    setPaymentPlan(
      lead.conversionSnapshot?.paymentPlan ?? (service.billingType === 'monthly' ? 'monthly' : service.allowTwoPayments ? 'two_payments' : 'full'),
    );
    setShowConversion(true);
  };

  return (
    <>
      <tr className="border-t border-os-border align-top">
        <td className={`border-l-4 px-3 py-3 text-left ${STAGE_VISUAL[lead.stage].border}`}>
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
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_VISUAL[lead.stage].dot}`} />
                  <div className="truncate text-[13px] font-semibold text-os-text">{lead.name}</div>
                </div>
                <div className="mt-0.5 text-[10px] text-os-dim">{lead.email || lead.phone || lead.whatsapp || 'Sin contacto'}</div>
                {(lead.phone || lead.whatsapp) && lead.email && <div className="mt-0.5 text-[10px] text-os-dim">{lead.phone || lead.whatsapp}</div>}
                <div className="mt-1"><WhatsAppStatusBadge lead={lead} /></div>
              </div>
            </div>
          </div>
        </td>
        {showClientColumn && <td className="px-3 py-3 text-left font-mono text-[10.5px] text-os-muted">{clientName}</td>}
        <td className="px-3 py-3 text-left">
          <select
            value={lead.stage}
            onChange={(event) => onStageChange(event.target.value as LeadStage)}
            disabled={isTerminal}
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
              Notas
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
                      <div className={`flex shrink-0 flex-col gap-0.5 rounded-sm-t border border-os-border bg-os-surface2 px-2.5 py-1.5 ${event.type === 'manual_note' ? 'max-w-[320px]' : ''}`}>
                        <span className="whitespace-nowrap font-mono text-[9.5px] uppercase tracking-wide text-os-text">
                          {eventLabel(event.type)}
                        </span>
                        {event.type === 'manual_note' && (
                          <span className="whitespace-pre-wrap break-words text-[10.5px] leading-relaxed text-os-muted">{event.summary}</span>
                        )}
                        <span className="whitespace-nowrap font-mono text-[8.5px] text-os-dim">{formatDateTime(event.occurredAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Semantic commercial quick actions — the canonical manual
                lifecycle path. Unlike the generic stage selector above
                (still available as an override/correction tool), these call
                POST /api/leads/[id]/commercial-events, so Results can read a
                real appointment_booked/appointment_completed/converted event
                regardless of whether it originated in Make or here. */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-os-border pt-3">
              <span className="mr-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Acciones comerciales</span>
              <button
                type="button"
                disabled={!canQualify}
                onClick={() => onCommercialEvent('qualified')}
                className="border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-muted hover:border-os-border-strong hover:text-os-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cualificar
              </button>
              <input
                type="datetime-local"
                value={appointmentDraft}
                onChange={(event) => setAppointmentDraft(event.target.value)}
                className="border border-os-border bg-os-surface2 px-2 py-1 font-mono text-[10px] text-os-text outline-none"
              />
              <button
                type="button"
                disabled={!appointmentDraft || isTerminal}
                onClick={() => {
                  const iso = fromDatetimeLocalValue(appointmentDraft);
                  if (iso) onCommercialEvent('appointment_booked', { appointmentDate: iso });
                }}
                className="border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-muted hover:border-os-border-strong hover:text-os-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cita agendada
              </button>
              <button
                type="button"
                disabled={isTerminal}
                onClick={() => onCommercialEvent('appointment_completed')}
                className="border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-muted hover:border-os-border-strong hover:text-os-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cita realizada
              </button>
              <button
                type="button"
                disabled={isTerminal || lead.stage === 'proposal_sent'}
                onClick={() => onCommercialEvent('proposal_sent')}
                className="border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-muted hover:text-os-accent disabled:opacity-40"
              >
                Propuesta enviada
              </button>
              <button
                type="button"
                disabled={services.length === 0 || lead.stage === 'disqualified'}
                onClick={openConversion}
                className="border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-muted hover:border-os-border-strong hover:text-os-accent"
              >
                {lead.conversionSnapshot ? 'Editar conversión' : 'Registrar conversión'}
              </button>
              <button
                type="button"
                disabled={isTerminal}
                onClick={() => onCommercialEvent('disqualified')}
                className="border border-os-border px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-os-muted hover:border-os-border-strong hover:text-os-err disabled:cursor-not-allowed disabled:opacity-40"
              >
                No cualificado
              </button>
            </div>
            <CommercialFinancePanel lead={lead} onRecordPayment={onRecordPayment} />
            <MetaCapiTestPanel lead={lead} deliveries={capiDeliveries} loading={capiLoading} onSend={onSendMetaCapiTest} />
            {showConversion && selectedService && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Registrar conversión">
                <div className="w-full max-w-xl border border-os-border-strong bg-os-surface p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div><div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-os-dim">Cierre comercial</div><h2 className="mt-1 text-lg font-semibold text-os-text">Registrar conversión</h2></div>
                    <button type="button" onClick={() => setShowConversion(false)} className="font-mono text-xs text-os-dim hover:text-os-text">Cerrar</button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="sm:col-span-2"><span className="font-mono text-[9px] uppercase tracking-wide text-os-dim">Servicio contratado</span><select value={serviceId} onChange={(event) => { const service = services.find((item) => item.id === event.target.value); if (!service) return; setServiceId(service.id); setAgreedValue(String(service.price)); setPaymentPlan(service.billingType === 'monthly' ? 'monthly' : service.allowTwoPayments ? 'two_payments' : 'full'); }} className="mt-1 w-full border border-os-border bg-os-surface2 px-3 py-2 text-sm text-os-text outline-none">{services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.price.toLocaleString('es-ES')} €{service.billingType === 'monthly' ? '/mes' : ''}</option>)}</select></label>
                    <label><span className="font-mono text-[9px] uppercase tracking-wide text-os-dim">Valor acordado</span><input type="number" min="0" step="0.01" value={agreedValue} onChange={(event) => setAgreedValue(event.target.value)} className="mt-1 w-full border border-os-border bg-os-surface2 px-3 py-2 text-sm text-os-text outline-none" /></label>
                    <label><span className="font-mono text-[9px] uppercase tracking-wide text-os-dim">Modalidad de pago</span><select value={paymentPlan} onChange={(event) => setPaymentPlan(event.target.value as ConversionPaymentPlan)} className="mt-1 w-full border border-os-border bg-os-surface2 px-3 py-2 text-sm text-os-text outline-none">{selectedService.billingType === 'one_off' && <option value="full">Pago completo</option>}{selectedService.allowTwoPayments && <option value="two_payments">Dos pagos</option>}{selectedService.billingType === 'monthly' && <option value="monthly">Mensual</option>}<option value="custom">Personalizado</option></select></label>
                    <label><span className="font-mono text-[9px] uppercase tracking-wide text-os-dim">Cobrado inicialmente</span><input type="number" min="0" step="0.01" value={initialPayment} disabled={lead.conversionSnapshot !== null} onChange={(event) => setInitialPayment(event.target.value)} className="mt-1 w-full border border-os-border bg-os-surface2 px-3 py-2 text-sm text-os-text outline-none disabled:opacity-50" /></label>
                    <div><span className="font-mono text-[9px] uppercase tracking-wide text-os-dim">Importe pendiente</span><div className="mt-1 border border-os-border bg-os-surface2 px-3 py-2 text-sm text-os-text">{Math.max(0, Number(agreedValue || 0) - Number(initialPayment || 0)).toLocaleString('es-ES')} €</div></div>
                  </div>
                  {selectedService.secondPaymentTrigger && paymentPlan === 'two_payments' && <p className="mt-3 text-[11px] text-os-muted">Segundo pago: {selectedService.secondPaymentTrigger}</p>}
                  <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowConversion(false)} className="border border-os-border px-3 py-2 font-mono text-[10px] uppercase text-os-muted">Cancelar</button><button type="button" onClick={() => { const value = Number(agreedValue); const paid = Number(initialPayment); if (!Number.isFinite(value) || !Number.isFinite(paid) || value < 0 || paid < 0 || paid > value) return; onCommercialEvent('converted', { conversionValue: value, serviceId, paymentPlan, initialPayment: paid }); setShowConversion(false); }} className="border border-os-accent bg-os-accent px-3 py-2 font-mono text-[10px] uppercase text-os-bg">Confirmar conversión</button></div>
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
  const [services, setServices] = useState<InternalBusinessService[]>([]);
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
  const [capiDeliveriesByLeadId, setCapiDeliveriesByLeadId] = useState<Record<string, LeadMetaCapiDelivery[]>>({});
  const [capiLoadingId, setCapiLoadingId] = useState<Record<string, boolean>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [editingLeadId, setEditingLeadId] = useState<string | null>(null);
  const [noteLeadId, setNoteLeadId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftLead>(emptyDraft());

  useEffect(() => {
    getInternalBusinessWorkspace()
      .then((workspace) => setServices(workspace.services.filter((service) => service.active)))
      .catch(() => setServices([]));
  }, []);

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

  const refreshMetaCapiForLead = useCallback(async (leadId: string) => {
    try {
      const deliveries = await getLeadMetaCapiDeliveries(leadId);
      setCapiDeliveriesByLeadId((prev) => ({ ...prev, [leadId]: deliveries }));
    } catch {
      // CAPI is supplementary operational evidence. A temporary failure to
      // load it must not hide the lead's existing commercial history.
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
      appointmentDate: toDatetimeLocalValue(lead.appointmentDate),
      conversionValue: lead.conversionValue != null ? String(lead.conversionValue) : '',
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
    const appointmentDate = fromDatetimeLocalValue(draft.appointmentDate);
    const conversionValueTrimmed = draft.conversionValue.trim();
    const conversionValue = conversionValueTrimmed ? Number(conversionValueTrimmed) : null;

    if (!name || (scope === 'client' && !clientId)) {
      return;
    }
    if (conversionValueTrimmed && (!Number.isFinite(conversionValue) || (conversionValue as number) < 0)) {
      setLoadError('El valor de conversión debe ser un número no negativo.');
      return;
    }

    try {
      if (editingLeadId) {
        // Business fields only — scope/clientId can't be changed once a
        // lead exists (see lib/api/leads.ts's UpdateLeadInput); the create
        // form's client selector is disabled in edit mode for this reason.
        const existing = leads.find((lead) => lead.id === editingLeadId);
        await updateLead(editingLeadId, {
          name,
          email,
          phone,
          whatsapp,
          source,
          campaign,
          adCreative,
          form,
          appointmentDate,
          conversionValue,
        });
        if (existing && existing.stage !== draft.stage) {
          if (draft.stage === 'proposal_sent' || draft.stage === 'qualified' || draft.stage === 'disqualified') {
            await appendCommercialEvent(editingLeadId, { type: draft.stage });
          } else {
            await setLeadStage(editingLeadId, draft.stage);
          }
        }
      } else {
        const semanticStage = draft.stage === 'proposal_sent' || draft.stage === 'qualified' || draft.stage === 'disqualified' ? draft.stage : null;
        const created = await createLead({
          scope,
          clientId,
          name,
          email,
          phone,
          whatsapp,
          source,
          campaign,
          adCreative,
          form,
          stage: semanticStage ? 'new' : draft.stage,
          appointmentDate,
          conversionValue,
        });
        if (semanticStage) {
          await appendCommercialEvent(created.lead.id, { type: semanticStage });
        }
      }
      await reloadLeads();
      closeForm();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo guardar el lead.');
    }
  };

  const handleStageChange = async (leadId: string, nextStage: LeadStage) => {
    try {
      if (nextStage === 'proposal_sent' || nextStage === 'qualified' || nextStage === 'disqualified') {
        await appendCommercialEvent(leadId, { type: nextStage });
      } else {
        await setLeadStage(leadId, nextStage);
      }
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
      setCapiLoadingId((prev) => ({ ...prev, [leadId]: true }));
      getLeadMetaCapiDeliveries(leadId)
        .then((deliveries) => setCapiDeliveriesByLeadId((prev) => ({ ...prev, [leadId]: deliveries })))
        .catch(() => setCapiDeliveriesByLeadId((prev) => ({ ...prev, [leadId]: [] })))
        .finally(() => setCapiLoadingId((prev) => ({ ...prev, [leadId]: false })));
    }
  };

  const handleCommercialEvent = async (
    leadId: string,
    type: CommercialEventType,
    payload?: { appointmentDate?: string } | ConversionPayload,
  ) => {
    try {
      if (type === 'appointment_booked') {
        const appointmentDate = payload && 'appointmentDate' in payload ? payload.appointmentDate : undefined;
        if (!appointmentDate) return;
        await appendCommercialEvent(leadId, { type, appointmentDate });
      } else if (type === 'converted') {
        const conversion = payload && 'conversionValue' in payload ? payload : undefined;
        await appendCommercialEvent(leadId, { type, ...conversion });
      } else {
        await appendCommercialEvent(leadId, { type });
      }
      await reloadLeads();
      await refreshEventsForLead(leadId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo registrar el evento comercial.');
    }
  };

  const handleRecordPayment = async (
    leadId: string,
    input: { amount: number; occurredAt: string; notes?: string | null },
  ) => {
    try {
      const result = await recordLeadPayment(leadId, input);
      setLeads((current) => current.map((lead) => (lead.id === leadId ? result.lead : lead)));
      await refreshEventsForLead(leadId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo registrar el cobro.');
      throw error;
    }
  };

  const handleMetaCapiTest = async (
    leadId: string,
    input: { kind: MetaCapiEventKind; testEventCode: string },
  ) => {
    try {
      const result = await sendLeadMetaCapiTestEvent(leadId, input);
      setCapiDeliveriesByLeadId((current) => {
        const existing = current[leadId] ?? [];
        const remaining = existing.filter((delivery) => delivery.id !== result.delivery.id);
        return { ...current, [leadId]: [result.delivery, ...remaining] };
      });
      await refreshEventsForLead(leadId);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo enviar la prueba de Meta CAPI.');
      await refreshMetaCapiForLead(leadId);
      await refreshEventsForLead(leadId);
      throw error;
    }
  };

  const handleAddManualNote = (leadId: string) => {
    setNoteLeadId(leadId);
    setNoteDraft('');
    setNoteError(null);
    setEventsLoadingId((prev) => ({ ...prev, [leadId]: true }));
    getLeadEvents(leadId)
      .then((events) => setEventsByLeadId((prev) => ({ ...prev, [leadId]: events })))
      .catch(() => setNoteError('No se pudieron cargar las notas anteriores.'))
      .finally(() => setEventsLoadingId((prev) => ({ ...prev, [leadId]: false })));
  };

  const submitNote = async () => {
    if (!noteLeadId || !noteDraft.trim() || noteSaving) return;
    setNoteSaving(true);
    setNoteError(null);
    try {
      await appendLeadEvent(noteLeadId, { summary: noteDraft.trim() });
      await reloadLeads();
      await refreshEventsForLead(noteLeadId);
      setNoteDraft('');
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : 'No se pudo guardar la nota.');
    } finally {
      setNoteSaving(false);
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

      <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full min-w-0 sm:w-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-os-dim" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar lead..."
            className="w-full min-w-0 border border-os-border bg-os-surface py-1.5 pl-8 pr-2.5 text-[12.5px] text-os-text outline-none placeholder:text-os-dim focus:border-os-border-strong sm:w-auto"
          />
        </div>

        <div className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          {STAGE_FILTERS.map((option) => {
            const active = stageFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setStageFilter(option.id as 'all' | LeadStage)}
                className={`min-w-0 break-words border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${
                  active ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-muted'
                }`}
              >
                {option.label} <span className="opacity-70">{stageCounts[option.id as 'all' | LeadStage] ?? 0}</span>
              </button>
            );
          })}
        </div>

        {moduleScope === 'client' && (
          <div className="flex w-full min-w-0 flex-col gap-1.5 sm:ml-auto sm:w-auto sm:flex-row sm:items-center sm:gap-2">
            <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Cliente</label>
            <select
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              className="w-full min-w-0 border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text sm:w-auto"
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

      <div className="grid gap-3 md:hidden">
        {loading ? (
          <div className="border border-dashed border-os-border px-3 py-6 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">Cargando leads...</div>
        ) : visibleLeads.length === 0 ? (
          <div className="border border-dashed border-os-border px-3 py-6 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">No hay leads que coincidan con estos filtros.</div>
        ) : visibleLeads.map((lead) => (
          <LeadMobileCard
            key={lead.id}
            lead={lead}
            clients={clients}
            services={lead.scope === 'internal' ? services : []}
            events={eventsByLeadId[lead.id] ?? []}
            eventsLoading={Boolean(eventsLoadingId[lead.id])}
            capiDeliveries={capiDeliveriesByLeadId[lead.id] ?? []}
            capiLoading={Boolean(capiLoadingId[lead.id])}
            showClient={showClientColumn}
            expanded={Boolean(expanded[lead.id])}
            onToggle={() => handleToggle(lead.id)}
            onStageChange={(nextStage) => handleStageChange(lead.id, nextStage)}
            onEdit={() => openEditForm(lead)}
            onAddNote={() => handleAddManualNote(lead.id)}
            onCommercialEvent={(type, payload) => handleCommercialEvent(lead.id, type, payload)}
            onRecordPayment={(input) => handleRecordPayment(lead.id, input)}
            onSendMetaCapiTest={(input) => handleMetaCapiTest(lead.id, input)}
          />
        ))}
      </div>

      <div className="hidden md:block">
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
                  services={lead.scope === 'internal' ? services : []}
                  events={eventsByLeadId[lead.id] ?? []}
                  eventsLoading={Boolean(eventsLoadingId[lead.id])}
                  capiDeliveries={capiDeliveriesByLeadId[lead.id] ?? []}
                  capiLoading={Boolean(capiLoadingId[lead.id])}
                  showClientColumn={showClientColumn}
                  columnCount={columnCount}
                  expanded={Boolean(expanded[lead.id])}
                  onToggle={() => handleToggle(lead.id)}
                  onStageChange={(nextStage) => handleStageChange(lead.id, nextStage)}
                  onEdit={() => openEditForm(lead)}
                  onAddNote={() => handleAddManualNote(lead.id)}
                  onCommercialEvent={(type, payload) => handleCommercialEvent(lead.id, type, payload)}
                  onRecordPayment={(input) => handleRecordPayment(lead.id, input)}
                  onSendMetaCapiTest={(input) => handleMetaCapiTest(lead.id, input)}
                />
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/60 p-3 sm:items-center sm:p-4">
          <div className="my-auto max-h-[calc(100vh-24px)] w-full max-w-2xl overflow-y-auto rounded-sm-t border border-os-border bg-os-surface p-4 sm:max-h-[calc(100vh-32px)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide">{editingLeadId ? 'Editar lead' : 'Nuevo lead'}</h2>
              <button type="button" onClick={closeForm} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                cerrar
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Fecha de cita</span>
                <input
                  type="datetime-local"
                  value={draft.appointmentDate}
                  onChange={(event) => setDraft((prev) => ({ ...prev, appointmentDate: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Valor de conversión (€)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.conversionValue}
                  onChange={(event) => setDraft((prev) => ({ ...prev, conversionValue: event.target.value }))}
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
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Notas del lead">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-sm-t border border-os-border bg-os-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-os-dim">Historial comercial</div>
                <h3 className="mt-1 text-sm font-semibold text-os-text">
                  Notas de {leads.find((lead) => lead.id === noteLeadId)?.name ?? 'este lead'}
                </h3>
              </div>
              <button type="button" onClick={() => setNoteLeadId(null)} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                cerrar
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border-y border-os-border py-3">
              {eventsLoadingId[noteLeadId] ? (
                <div className="font-mono text-[10px] text-os-dim">Cargando notas...</div>
              ) : (eventsByLeadId[noteLeadId] ?? []).filter((event) => event.type === 'manual_note').length === 0 ? (
                <div className="border border-dashed border-os-border px-3 py-5 text-center font-mono text-[10px] text-os-dim">Todavía no hay notas para este lead.</div>
              ) : (
                <div className="space-y-2">
                  {(eventsByLeadId[noteLeadId] ?? [])
                    .filter((event) => event.type === 'manual_note')
                    .slice()
                    .reverse()
                    .map((event) => (
                      <article key={event.id} className="border border-os-border bg-os-surface2 px-3 py-2.5">
                        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-os-text">{event.summary}</p>
                        <time className="mt-2 block font-mono text-[8.5px] text-os-dim">{formatDateTime(event.occurredAt)}</time>
                      </article>
                    ))}
                </div>
              )}
            </div>
            <label className="mt-3 block">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">Nueva nota</span>
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              rows={5}
              autoFocus
              className="mt-1 w-full resize-y border border-os-border bg-os-surface2 p-3 text-sm leading-relaxed text-os-text outline-none focus:border-os-border-strong"
              placeholder="Escribe aquí mientras hablas con el lead..."
            />
            </label>
            {noteError && <div className="mt-2 border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[10px] text-os-err">{noteError}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setNoteLeadId(null)} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Cerrar
              </button>
              <button type="button" onClick={submitNote} disabled={!noteDraft.trim() || noteSaving} className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface disabled:cursor-not-allowed disabled:opacity-40">
                {noteSaving ? 'Guardando...' : 'Guardar nota'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

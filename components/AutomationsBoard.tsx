'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getClients, initializeStoreIfNeeded, type Client } from '@/lib/clients';
import {
  AUTOMATION_PLATFORM_OPTIONS,
  AUTOMATION_STATUS_OPTIONS,
  AUTOMATION_TYPE_OPTIONS,
  createAutomation,
  getAutomationHealth,
  getAutomationRuns,
  getAutomationStats,
  getAutomations,
  getClientNameForAutomation,
  getHealthLabel,
  getPlatformLabel,
  getRunStatusLabel,
  getStatusLabel,
  getTypeLabel,
  initializeAutomationsStoreIfNeeded,
  setAutomationStatus,
  summarizeAutomations,
  updateAutomation,
  type Automation,
  type AutomationHealth,
  type AutomationPlatform,
  type AutomationRun,
  type AutomationStatus,
  type AutomationStep,
  type AutomationType,
} from '@/lib/automations';

const STATUS_FILTERS = [{ id: 'all', label: 'Todas' }, ...AUTOMATION_STATUS_OPTIONS];
const PLATFORM_FILTERS = [{ id: 'all', label: 'Todas las plataformas' }, ...AUTOMATION_PLATFORM_OPTIONS];

type DraftStep = {
  id: string;
  platform: AutomationPlatform;
  action: string;
  description: string;
};

type DraftAutomation = {
  clientId: string;
  name: string;
  description: string;
  status: AutomationStatus;
  type: AutomationType;
  platforms: AutomationPlatform[];
  triggerPlatform: AutomationPlatform;
  triggerEvent: string;
  triggerDescription: string;
  steps: DraftStep[];
  externalProvider: '' | AutomationPlatform;
  externalAutomationId: string;
};

const emptyDraft = (clientId = ''): DraftAutomation => ({
  clientId,
  name: '',
  description: '',
  status: 'draft',
  type: 'lead_response',
  platforms: [],
  triggerPlatform: 'internal',
  triggerEvent: '',
  triggerDescription: '',
  steps: [],
  externalProvider: '',
  externalAutomationId: '',
});

function newDraftStep(): DraftStep {
  return { id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, platform: 'internal', action: '', description: '' };
}

function buildSteps(steps: DraftStep[]): AutomationStep[] {
  return steps
    .filter((step) => step.action.trim().length > 0)
    .map((step, index) => ({
      id: step.id,
      order: index + 1,
      platform: step.platform,
      action: step.action.trim(),
      description: step.description.trim(),
    }));
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-ES', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

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

const HEALTH_TONE: Record<AutomationHealth, string> = {
  healthy: 'text-os-ok',
  needs_attention: 'text-os-err',
  never_run: 'text-os-dim',
};

const STATUS_TONE: Record<AutomationStatus, string> = {
  active: 'text-os-ok',
  paused: 'text-os-muted',
  draft: 'text-os-dim',
};

// Trigger platforms that describe *how/when* an automation fires rather than
// *what business platform it concerns* — too generic to stand in as the
// automation's identity mark, even when they're the literal trigger.
const LOW_SIGNAL_TRIGGERS = new Set<AutomationPlatform>(['internal', 'calendar', 'make']);

// Preference order once we fall back to scanning all involved platforms —
// customer-facing delivery/acquisition channels read as more "the automation"
// than back-office or orchestration tooling.
const PLATFORM_REPRESENTATIVENESS: AutomationPlatform[] = [
  'whatsapp',
  'manychat',
  'meta',
  'openai',
  'google_sheets',
  'calendar',
  'make',
];

/** The one platform that best identifies an automation at a glance. The trigger
 * wins when it's already a recognizable business platform (Meta, WhatsApp,
 * ManyChat, OpenAI, Google Sheets) — it's the acquisition/origin point, which is
 * usually the automation's defining feature. When the trigger is a low-signal
 * utility (internal, calendar, make), fall back to the most representative
 * platform actually involved. Only automations with no non-internal platform at
 * all fall through to the neutral internal badge. */
function getPrimaryPlatform(automation: Automation): AutomationPlatform {
  const trigger = automation.trigger.platform;
  if (!LOW_SIGNAL_TRIGGERS.has(trigger)) return trigger;

  for (const platform of PLATFORM_REPRESENTATIVENESS) {
    if (automation.platforms.includes(platform)) return platform;
  }
  return 'internal';
}

function HealthBadge({ health }: { health: AutomationHealth }) {
  return (
    <span className={`inline-block border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide ${HEALTH_TONE[health]}`}>
      {getHealthLabel(health)}
    </span>
  );
}

function DataSourceTag({ dataSource }: { dataSource: Automation['dataSource'] }) {
  const tone = dataSource === 'live' ? 'text-os-ok' : dataSource === 'manual' ? 'text-os-muted' : 'text-os-dim';
  const label = dataSource === 'live' ? 'En vivo' : dataSource === 'manual' ? 'Manual' : 'Demo';
  return (
    <span className={`inline-block border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}

/** Small inline platform identifier — real brand logo (rendered server-side and
 * passed down as platformLogos, since the logos pull simple-icons which must
 * never enter the client bundle) + label. Used for the trigger, each workflow
 * step, and the external reference line in the expanded detail. */
function PlatformLabel({
  platform,
  platformLogos,
  className,
}: {
  platform: AutomationPlatform;
  platformLogos: Record<string, ReactNode>;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
      {platformLogos[platform]}
      <span>{getPlatformLabel(platform)}</span>
    </span>
  );
}

function PlatformTags({ platforms, platformLogos }: { platforms: AutomationPlatform[]; platformLogos: Record<string, ReactNode> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {platforms.map((platform) => (
        <span
          key={platform}
          className="flex items-center gap-1 border border-os-border bg-os-surface2 py-0.5 pl-0.5 pr-1.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim"
        >
          {platformLogos[platform]}
          {getPlatformLabel(platform)}
        </span>
      ))}
    </div>
  );
}

function RunHistory({ runs }: { runs: AutomationRun[] }) {
  if (runs.length === 0) {
    return <span className="font-mono text-[10px] text-os-dim">Sin ejecuciones.</span>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {runs.slice(0, 6).map((run) => (
        <div key={run.id} className="flex flex-wrap items-center gap-2 border border-os-border bg-os-surface2 px-2 py-1.5">
          <span
            className={`font-mono text-[9px] font-bold uppercase tracking-wide ${
              run.status === 'success' ? 'text-os-ok' : run.status === 'failed' ? 'text-os-err' : 'text-os-muted'
            }`}
          >
            {getRunStatusLabel(run.status)}
          </span>
          <span className="font-mono text-[9.5px] text-os-dim">{formatDateTime(run.startedAt)}</span>
          <span className="font-mono text-[10px] text-os-muted">{run.summary}</span>
          {run.error && <span className="font-mono text-[9.5px] text-os-err">{run.error}</span>}
        </div>
      ))}
    </div>
  );
}

function AutomationCard({
  automation,
  clientName,
  platformLogos,
  platformIconsLarge,
  expanded,
  onToggle,
  onStatusChange,
  onEdit,
}: {
  automation: Automation;
  clientName: string;
  platformLogos: Record<string, ReactNode>;
  platformIconsLarge: Record<string, ReactNode>;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (next: AutomationStatus) => void;
  onEdit: () => void;
}) {
  const health = getAutomationHealth(automation);
  const stats = getAutomationStats(automation.id);
  const runs = expanded ? getAutomationRuns(automation.id) : [];
  const primaryPlatform = getPrimaryPlatform(automation);

  return (
    <div className="flex flex-col border border-os-border bg-os-surface p-3.5">
      {/* Identity row — logo + name + client + status + health, scannable at a glance */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {platformIconsLarge[primaryPlatform]}
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold leading-tight text-os-text">{automation.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-os-muted">
              <span className="truncate">{clientName}</span>
              <span className="text-os-dim">·</span>
              <span className="text-os-dim">{getTypeLabel(automation.type)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <HealthBadge health={health} />
          <select
            value={automation.status}
            onChange={(event) => onStatusChange(event.target.value as AutomationStatus)}
            className={`border border-os-border bg-os-surface px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide outline-none ${STATUS_TONE[automation.status]}`}
          >
            {AUTOMATION_STATUS_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {health === 'needs_attention' && automation.lastError && (
        <div className="mt-2 truncate border border-os-err/40 bg-os-err/10 px-2 py-1 font-mono text-[9.5px] text-os-err" title={automation.lastError}>
          ⚠ {automation.lastError}
        </div>
      )}

      <div className="mt-2.5">
        <PlatformTags platforms={automation.platforms} platformLogos={platformLogos} />
      </div>

      {/* Compact operational summary */}
      <div className="mt-3 grid grid-cols-4 gap-2 border-t border-os-border pt-2.5">
        <div>
          <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Última ejecución</div>
          <div className="mt-0.5 font-mono text-[10.5px] text-os-muted">{formatRelative(automation.lastRunAt)}</div>
        </div>
        <div>
          <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Ejecuciones</div>
          <div className="mt-0.5 font-mono text-[10.5px] text-os-muted">{stats.totalRuns}</div>
        </div>
        <div>
          <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Fallos</div>
          <div className={`mt-0.5 font-mono text-[10.5px] ${stats.failedRuns > 0 ? 'text-os-err' : 'text-os-muted'}`}>{stats.failedRuns}</div>
        </div>
        <div>
          <div className="font-mono text-[8.5px] uppercase tracking-wide text-os-dim">Éxito</div>
          <div className="mt-0.5 font-mono text-[10.5px] text-os-muted">{formatPercent(stats.successRate)}</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-os-border pt-2.5">
        <DataSourceTag dataSource={automation.dataSource} />
        <div className="flex items-center gap-3">
          <button type="button" onClick={onEdit} className="font-mono text-[9px] uppercase tracking-wide text-os-muted hover:text-os-accent">
            editar
          </button>
          <button type="button" onClick={onToggle} className="font-mono text-[9px] uppercase tracking-wide text-os-dim hover:text-os-accent">
            {expanded ? '− ocultar detalle' : '+ detalle'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-4 border-t border-os-border pt-3 md:grid-cols-2">
          <div>
            <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Disparador</div>
            <div className="border border-os-border bg-os-surface2 px-2.5 py-2">
              <PlatformLabel platform={automation.trigger.platform} platformLogos={platformLogos} className="font-mono text-[9px] uppercase tracking-wide text-os-accent" />
              <div className="mt-1 text-[11px] text-os-text">{automation.trigger.event}</div>
              <div className="mt-0.5 text-[10px] text-os-dim">{automation.trigger.description}</div>
            </div>

            <div className="mb-1.5 mt-3 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Pasos del flujo</div>
            {automation.steps.length === 0 ? (
              <span className="font-mono text-[10px] text-os-dim">Sin pasos registrados.</span>
            ) : (
              <div className="flex flex-col gap-1.5">
                {automation.steps
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((step) => (
                    <div key={step.id} className="flex items-start gap-2 border border-os-border bg-os-surface2 px-2.5 py-1.5">
                      <span className="mt-0.5 font-mono text-[9px] text-os-dim">{step.order}.</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <PlatformLabel platform={step.platform} platformLogos={platformLogos} className="font-mono text-[9px] uppercase tracking-wide text-os-accent" />
                          <span className="text-[11px] font-medium text-os-text">{step.action}</span>
                        </div>
                        {step.description && <div className="mt-0.5 text-[10px] text-os-dim">{step.description}</div>}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[9.5px] text-os-dim">
              <div>
                <div className="uppercase tracking-wide">Creado</div>
                <div className="mt-0.5 text-os-muted">{formatDateTime(automation.createdAt)}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Actualizado</div>
                <div className="mt-0.5 text-os-muted">{formatDateTime(automation.updatedAt)}</div>
              </div>
              {automation.externalProvider && (
                <div className="col-span-2">
                  <div className="uppercase tracking-wide">Referencia externa</div>
                  <div className="mt-0.5">
                    <PlatformLabel platform={automation.externalProvider} platformLogos={platformLogos} className="text-os-muted" />
                    <span className="text-os-muted"> · {automation.externalAutomationId ?? '—'}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Historial de ejecuciones recientes</span>
              <span className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">{stats.totalRuns} ejecuciones</span>
            </div>
            <RunHistory runs={runs} />
            {automation.description && (
              <>
                <div className="mb-1.5 mt-3 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Descripción</div>
                <p className="text-[11px] text-os-muted">{automation.description}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AutomationsBoard({
  platformLogos,
  platformIconsLarge,
}: {
  platformLogos: Record<string, ReactNode>;
  platformIconsLarge: Record<string, ReactNode>;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | AutomationStatus>('all');
  const [clientFilter, setClientFilter] = useState<'all' | string>('all');
  const [platformFilter, setPlatformFilter] = useState<'all' | AutomationPlatform>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showForm, setShowForm] = useState(false);
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftAutomation>(emptyDraft());

  const loadAutomations = () => {
    const activeClient = clientFilter === 'all' ? undefined : clientFilter;
    setAutomations(getAutomations(activeClient));
  };

  useEffect(() => {
    initializeStoreIfNeeded();
    initializeAutomationsStoreIfNeeded();
    setClients(getClients());
    setAutomations(getAutomations());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAutomations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter]);

  const visibleAutomations = useMemo(
    () =>
      automations.filter((automation) => {
        if (statusFilter !== 'all' && automation.status !== statusFilter) return false;
        if (platformFilter !== 'all' && !automation.platforms.includes(platformFilter)) return false;
        return true;
      }),
    [automations, statusFilter, platformFilter],
  );

  const summary = useMemo(() => summarizeAutomations(visibleAutomations), [visibleAutomations]);

  const openCreateForm = () => {
    const firstClient = clients[0]?.id ?? '';
    setDraft(emptyDraft(firstClient));
    setEditingAutomationId(null);
    setShowForm(true);
  };

  const openEditForm = (automation: Automation) => {
    setEditingAutomationId(automation.id);
    setDraft({
      clientId: automation.clientId,
      name: automation.name,
      description: automation.description,
      status: automation.status,
      type: automation.type,
      platforms: automation.platforms,
      triggerPlatform: automation.trigger.platform,
      triggerEvent: automation.trigger.event,
      triggerDescription: automation.trigger.description,
      steps: automation.steps
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((step) => ({ id: step.id, platform: step.platform, action: step.action, description: step.description })),
      externalProvider: automation.externalProvider ?? '',
      externalAutomationId: automation.externalAutomationId ?? '',
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingAutomationId(null);
    setDraft(emptyDraft(clients[0]?.id ?? ''));
  };

  const togglePlatform = (platform: AutomationPlatform) => {
    setDraft((prev) => ({
      ...prev,
      platforms: prev.platforms.includes(platform) ? prev.platforms.filter((p) => p !== platform) : [...prev.platforms, platform],
    }));
  };

  const addStep = () => setDraft((prev) => ({ ...prev, steps: [...prev.steps, newDraftStep()] }));
  const removeStep = (id: string) => setDraft((prev) => ({ ...prev, steps: prev.steps.filter((s) => s.id !== id) }));
  const updateStep = (id: string, patch: Partial<DraftStep>) =>
    setDraft((prev) => ({ ...prev, steps: prev.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const submitAutomation = () => {
    const name = draft.name.trim();
    if (!name || !draft.clientId || draft.platforms.length === 0) return;

    const trigger = {
      platform: draft.triggerPlatform,
      event: draft.triggerEvent.trim(),
      description: draft.triggerDescription.trim(),
    };
    const steps = buildSteps(draft.steps);
    const externalProvider = draft.externalProvider === '' ? null : draft.externalProvider;
    // Provider = None must never leave a stale external id behind, regardless of draft state.
    const externalAutomationId = externalProvider === null ? null : draft.externalAutomationId.trim() || null;

    if (editingAutomationId) {
      updateAutomation(editingAutomationId, {
        clientId: draft.clientId,
        name,
        description: draft.description.trim(),
        status: draft.status,
        type: draft.type,
        platforms: draft.platforms,
        trigger,
        steps,
        externalProvider,
        externalAutomationId,
      });
    } else {
      createAutomation({
        clientId: draft.clientId,
        name,
        description: draft.description.trim(),
        status: draft.status,
        type: draft.type,
        platforms: draft.platforms,
        trigger,
        steps,
        externalProvider,
        externalAutomationId,
        dataSource: 'manual',
      });
    }

    const activeClient = clientFilter === 'all' ? undefined : clientFilter;
    setAutomations(getAutomations(activeClient));
    closeForm();
  };

  const handleStatusChange = (automationId: string, next: AutomationStatus) => {
    setAutomationStatus(automationId, next);
    const activeClient = clientFilter === 'all' ? undefined : clientFilter;
    setAutomations(getAutomations(activeClient));
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-os-dim">REKREATIVE OPERACIONES</div>
          <h1 className="mt-1 text-[25px] font-bold uppercase tracking-[0.06em] text-os-text">Automatizaciones</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCreateForm}
            className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
          >
            Nueva automatización
          </button>
        </div>
      </div>

      {/* KPI summary */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: 'Activas', value: String(summary.active) },
          { label: 'Requiere atención', value: String(summary.needsAttention), tone: summary.needsAttention > 0 ? 'text-os-err' : undefined },
          { label: 'Ejecuciones', value: String(summary.totalRuns) },
          { label: 'Fallos', value: String(summary.totalFailures), tone: summary.totalFailures > 0 ? 'text-os-err' : undefined },
          { label: 'Tasa de éxito', value: formatPercent(summary.successRate) },
        ].map((tile) => (
          <div key={tile.label} className="border border-os-border bg-os-surface px-3 py-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">{tile.label}</div>
            <div className={`mt-1.5 font-mono text-[18px] font-semibold ${tile.tone ?? 'text-os-text'}`}>{tile.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((option) => {
            const active = statusFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatusFilter(option.id as 'all' | AutomationStatus)}
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
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Plataforma</label>
          <select
            value={platformFilter}
            onChange={(event) => setPlatformFilter(event.target.value as 'all' | AutomationPlatform)}
            className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
          >
            {PLATFORM_FILTERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
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
      </div>

      {/* Automation cards — fast visual scanning: icon + name + client + health first */}
      {visibleAutomations.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          No hay automatizaciones en este segmento.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visibleAutomations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              clientName={getClientNameForAutomation(automation.clientId)}
              platformLogos={platformLogos}
              platformIconsLarge={platformIconsLarge}
              expanded={Boolean(expanded[automation.id])}
              onToggle={() => setExpanded((prev) => ({ ...prev, [automation.id]: !prev[automation.id] }))}
              onStatusChange={(next) => handleStatusChange(automation.id, next)}
              onEdit={() => openEditForm(automation)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-sm-t border border-os-border bg-os-surface p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide">{editingAutomationId ? 'Editar automatización' : 'Nueva automatización'}</h2>
              <button type="button" onClick={closeForm} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                cerrar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Cliente</span>
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

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Nombre</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Descripción</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                  className="h-16 w-full resize-none border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Estado</span>
                <select
                  value={draft.status}
                  onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value as AutomationStatus }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  {AUTOMATION_STATUS_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Tipo</span>
                <select
                  value={draft.type}
                  onChange={(event) => setDraft((prev) => ({ ...prev, type: event.target.value as AutomationType }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  {AUTOMATION_TYPE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Plataformas</span>
                <div className="flex flex-wrap gap-1.5">
                  {AUTOMATION_PLATFORM_OPTIONS.map((option) => {
                    const on = draft.platforms.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => togglePlatform(option.id)}
                        className={`inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${
                          on ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim hover:border-os-border-strong'
                        }`}
                      >
                        {platformLogos[option.id]}
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="col-span-2 border-t border-os-border pt-3">
                <span className="mb-2 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Disparador</span>
                <div className="grid grid-cols-2 gap-3">
                  <label className="col-span-1">
                    <span className="mb-1 block font-mono text-[9px] uppercase tracking-wide text-os-dim">Plataforma</span>
                    <select
                      value={draft.triggerPlatform}
                      onChange={(event) => setDraft((prev) => ({ ...prev, triggerPlatform: event.target.value as AutomationPlatform }))}
                      className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                    >
                      {AUTOMATION_PLATFORM_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="col-span-1">
                    <span className="mb-1 block font-mono text-[9px] uppercase tracking-wide text-os-dim">Evento</span>
                    <input
                      value={draft.triggerEvent}
                      onChange={(event) => setDraft((prev) => ({ ...prev, triggerEvent: event.target.value }))}
                      placeholder="p. ej. Envío de formulario de anuncio de leads"
                      className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                    />
                  </label>
                  <label className="col-span-2">
                    <span className="mb-1 block font-mono text-[9px] uppercase tracking-wide text-os-dim">Descripción</span>
                    <input
                      value={draft.triggerDescription}
                      onChange={(event) => setDraft((prev) => ({ ...prev, triggerDescription: event.target.value }))}
                      className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                    />
                  </label>
                </div>
              </div>

              <div className="col-span-2 border-t border-os-border pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Pasos del flujo</span>
                  <button type="button" onClick={addStep} className="font-mono text-[9px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                    + añadir paso
                  </button>
                </div>
                {draft.steps.length === 0 ? (
                  <span className="font-mono text-[10px] text-os-dim">Sin pasos todavía — solo descriptivo, no se ejecuta en la V1.</span>
                ) : (
                  <div className="flex flex-col gap-2">
                    {draft.steps.map((step, index) => (
                      <div key={step.id} className="border border-os-border bg-os-surface2 p-2">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="font-mono text-[9px] text-os-dim">Paso {index + 1}</span>
                          <button type="button" onClick={() => removeStep(step.id)} className="font-mono text-[9px] uppercase tracking-wide text-os-dim hover:text-os-err">
                            eliminar
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <select
                            value={step.platform}
                            onChange={(event) => updateStep(step.id, { platform: event.target.value as AutomationPlatform })}
                            className="col-span-1 border border-os-border bg-os-surface px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-os-text"
                          >
                            {AUTOMATION_PLATFORM_OPTIONS.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <input
                            value={step.action}
                            onChange={(event) => updateStep(step.id, { action: event.target.value })}
                            placeholder="Acción, p. ej. Calificar lead"
                            className="col-span-2 border border-os-border bg-os-surface px-2 py-1.5 text-[11px] text-os-text outline-none"
                          />
                          <input
                            value={step.description}
                            onChange={(event) => updateStep(step.id, { description: event.target.value })}
                            placeholder="Descripción (opcional)"
                            className="col-span-3 border border-os-border bg-os-surface px-2 py-1.5 text-[11px] text-os-text outline-none"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="col-span-2 border-t border-os-border pt-3">
                <span className="mb-2 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Referencia externa (opcional)</span>
                <div className="grid grid-cols-2 gap-3">
                  <label className="col-span-1">
                    <span className="mb-1 block font-mono text-[9px] uppercase tracking-wide text-os-dim">Proveedor</span>
                    <select
                      value={draft.externalProvider}
                      onChange={(event) => {
                        const nextProvider = event.target.value as '' | AutomationPlatform;
                        // None must not preserve a stale external id from a previously selected provider.
                        setDraft((prev) => ({ ...prev, externalProvider: nextProvider, externalAutomationId: nextProvider === '' ? '' : prev.externalAutomationId }));
                      }}
                      className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                    >
                      <option value="">Ninguno</option>
                      {AUTOMATION_PLATFORM_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="col-span-1">
                    <span className="mb-1 block font-mono text-[9px] uppercase tracking-wide text-os-dim">ID externo</span>
                    <input
                      value={draft.externalAutomationId}
                      disabled={draft.externalProvider === ''}
                      onChange={(event) => setDraft((prev) => ({ ...prev, externalAutomationId: event.target.value }))}
                      placeholder={draft.externalProvider === '' ? 'Selecciona primero un proveedor' : 'Se completará cuando se conecte una integración en vivo'}
                      className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Cancelar
              </button>
              <button type="button" onClick={submitAutomation} className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface">
                {editingAutomationId ? 'Guardar automatización' : 'Crear automatización'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

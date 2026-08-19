'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getClients, initializeStoreIfNeeded, type Client } from '@/lib/clients';
import {
  AI_AGENT_CAPABILITY_OPTIONS,
  AI_AGENT_CHANNEL_OPTIONS,
  AI_AGENT_PROVIDER_OPTIONS,
  AI_AGENT_STATUS_OPTIONS,
  AI_AGENT_USE_CASE_OPTIONS,
  createAiAgent,
  getAiAgentCapabilityLabel,
  getAiAgentChannelLabel,
  getAiAgentConfigurationStatus,
  getAiAgentConfigurationStatusLabel,
  getAiAgentProviderLabel,
  getAiAgentUseCaseLabel,
  getAiAgents,
  getClientNameForAiAgent,
  initializeAiAgentsStoreIfNeeded,
  setAiAgentStatus,
  summarizeAiAgents,
  updateAiAgent,
  type AiAgent,
  type AiAgentCapability,
  type AiAgentChannel,
  type AiAgentProvider,
  type AiAgentScope,
  type AiAgentStatus,
  type AiAgentUseCase,
} from '@/lib/agents-ai';
import { Badge } from '@/components/terminal';

const STATUS_FILTERS = [{ id: 'all', label: 'Todos' }, ...AI_AGENT_STATUS_OPTIONS];
const PROVIDER_FILTERS = [{ id: 'all', label: 'Todos los proveedores' }, ...AI_AGENT_PROVIDER_OPTIONS];
const CHANNEL_FILTERS = [{ id: 'all', label: 'Todos los canales' }, ...AI_AGENT_CHANNEL_OPTIONS];
const INTERNAL_FILTER = '__internal__';

type DraftAgent = {
  scope: AiAgentScope;
  clientId: string;
  name: string;
  role: string;
  purpose: string;
  status: AiAgentStatus;
  provider: '' | AiAgentProvider;
  model: string;
  channel: '' | AiAgentChannel;
  useCase: '' | AiAgentUseCase;
  capabilities: AiAgentCapability[];
  instructions: string;
  knowledgeNotes: string;
};

const emptyDraft = (clientId = ''): DraftAgent => ({
  scope: 'client',
  clientId,
  name: '',
  role: '',
  purpose: '',
  status: 'draft',
  provider: '',
  model: '',
  channel: '',
  useCase: '',
  capabilities: [],
  instructions: '',
  knowledgeNotes: '',
});

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
}

const STATUS_TONE: Record<AiAgentStatus, string> = {
  active: 'text-os-ok',
  paused: 'text-os-muted',
  draft: 'text-os-dim',
};

function ConfigurationStatusBadge({ agent }: { agent: AiAgent }) {
  const status = getAiAgentConfigurationStatus(agent);
  return <Badge tone={status === 'complete' ? 'ok' : 'warn'}>{getAiAgentConfigurationStatusLabel(status)}</Badge>;
}

function DataSourceTag({ dataSource }: { dataSource: AiAgent['dataSource'] }) {
  const tone = dataSource === 'manual' ? 'text-os-muted' : 'text-os-dim';
  const label = dataSource === 'manual' ? 'Manual' : 'Demo';
  return (
    <span className={`inline-block border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}

function CapabilityChips({ capabilities }: { capabilities: AiAgentCapability[] }) {
  if (capabilities.length === 0) {
    return <span className="font-mono text-[10px] text-os-dim">Sin capacidades definidas.</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {capabilities.map((capability) => (
        <span
          key={capability}
          className="border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-os-dim"
        >
          {getAiAgentCapabilityLabel(capability)}
        </span>
      ))}
    </div>
  );
}

/** Small inline provider/channel identifier — real brand logo (rendered
 * server-side and passed down as providerLogos/channelLogos, since the logos
 * pull simple-icons which must never enter the client bundle) + label. */
function BrandChip({ logo, label }: { logo: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
      {logo}
      {label}
    </span>
  );
}

function AgentCard({
  agent,
  clientName,
  providerLogos,
  channelLogos,
  channelIconsLarge,
  noChannelIcon,
  expanded,
  onToggle,
  onStatusChange,
  onEdit,
}: {
  agent: AiAgent;
  clientName: string;
  providerLogos: Record<string, ReactNode>;
  channelLogos: Record<string, ReactNode>;
  channelIconsLarge: Record<string, ReactNode>;
  noChannelIcon: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (next: AiAgentStatus) => void;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-col border border-os-border bg-os-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {/* Primary identity mark = WHERE the agent operates (main channel), not who powers it. */}
          {agent.channel ? channelIconsLarge[agent.channel] : noChannelIcon}
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold leading-tight text-os-text">{agent.name || 'Sin nombre'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-os-muted">
              <span className="truncate">{clientName}</span>
              {agent.role && (
                <>
                  <span className="text-os-dim">·</span>
                  <span className="truncate text-os-dim">{agent.role}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <ConfigurationStatusBadge agent={agent} />
          <select
            value={agent.status}
            onChange={(event) => onStatusChange(event.target.value as AiAgentStatus)}
            className={`border border-os-border bg-os-surface px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide outline-none ${STATUS_TONE[agent.status]}`}
          >
            {AI_AGENT_STATUS_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {agent.purpose && <p className="mt-2.5 line-clamp-2 text-[11px] text-os-muted">{agent.purpose}</p>}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <BrandChip
          logo={agent.provider ? providerLogos[agent.provider] : null}
          label={`${agent.provider ? getAiAgentProviderLabel(agent.provider) : 'Sin proveedor'}${agent.model ? ` · ${agent.model}` : ''}`}
        />
        {agent.channel && <BrandChip logo={channelLogos[agent.channel]} label={getAiAgentChannelLabel(agent.channel)} />}
        {agent.useCase && (
          <span className="border border-os-border bg-os-surface2 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-os-dim">
            {getAiAgentUseCaseLabel(agent.useCase)}
          </span>
        )}
      </div>

      <div className="mt-2.5">
        <CapabilityChips capabilities={agent.capabilities} />
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-os-border pt-2.5">
        <DataSourceTag dataSource={agent.dataSource} />
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
            <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Propósito</div>
            <p className="text-[11px] text-os-muted">{agent.purpose || 'Sin descripción.'}</p>

            <div className="mb-1.5 mt-3 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Instrucciones</div>
            <pre className="whitespace-pre-wrap border border-os-border bg-os-surface2 p-2.5 font-mono text-[10.5px] leading-relaxed text-os-text">
              {agent.instructions || 'Sin instrucciones definidas.'}
            </pre>

            {agent.knowledgeNotes && (
              <>
                <div className="mb-1.5 mt-3 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Notas de conocimiento</div>
                <p className="text-[11px] text-os-muted">{agent.knowledgeNotes}</p>
              </>
            )}
          </div>

          <div>
            <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Configuración</div>
            <div className="grid grid-cols-2 gap-2 font-mono text-[9.5px] text-os-dim">
              <div>
                <div className="uppercase tracking-wide">Proveedor</div>
                <div className="mt-0.5 text-os-muted">{agent.provider ? getAiAgentProviderLabel(agent.provider) : '—'}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Modelo</div>
                <div className="mt-0.5 text-os-muted">{agent.model ?? '—'}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Canal</div>
                <div className="mt-0.5 text-os-muted">{agent.channel ? getAiAgentChannelLabel(agent.channel) : '—'}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Caso de uso</div>
                <div className="mt-0.5 text-os-muted">{agent.useCase ? getAiAgentUseCaseLabel(agent.useCase) : '—'}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Creado</div>
                <div className="mt-0.5 text-os-muted">{formatDate(agent.createdAt)}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Actualizado</div>
                <div className="mt-0.5 text-os-muted">{formatDate(agent.updatedAt)}</div>
              </div>
            </div>

            <div className="mb-1.5 mt-3 font-mono text-[9.5px] uppercase tracking-[0.18em] text-os-dim">Capacidades</div>
            <CapabilityChips capabilities={agent.capabilities} />
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentsAiBoard({
  providerLogos,
  channelLogos,
  channelIconsLarge,
  noChannelIcon,
}: {
  providerLogos: Record<string, ReactNode>;
  channelLogos: Record<string, ReactNode>;
  channelIconsLarge: Record<string, ReactNode>;
  noChannelIcon: ReactNode;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | AiAgentStatus>('all');
  const [clientFilter, setClientFilter] = useState<'all' | string>('all');
  const [providerFilter, setProviderFilter] = useState<'all' | AiAgentProvider>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | AiAgentChannel>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showForm, setShowForm] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftAgent>(emptyDraft());

  const loadAgents = () => {
    const activeClient = clientFilter === 'all' || clientFilter === INTERNAL_FILTER ? undefined : clientFilter;
    setAgents(getAiAgents(activeClient));
  };

  useEffect(() => {
    initializeStoreIfNeeded();
    initializeAiAgentsStoreIfNeeded();
    setClients(getClients());
    setAgents(getAiAgents());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter]);

  const visibleAgents = useMemo(
    () =>
      agents.filter((agent) => {
        if (clientFilter === INTERNAL_FILTER && agent.clientId !== null) return false;
        if (statusFilter !== 'all' && agent.status !== statusFilter) return false;
        if (providerFilter !== 'all' && agent.provider !== providerFilter) return false;
        if (channelFilter !== 'all' && agent.channel !== channelFilter) return false;
        return true;
      }),
    [agents, statusFilter, providerFilter, channelFilter, clientFilter],
  );

  const summary = useMemo(() => summarizeAiAgents(visibleAgents), [visibleAgents]);

  const openCreateForm = () => {
    const firstClient = clients[0]?.id ?? '';
    setDraft(emptyDraft(firstClient));
    setEditingAgentId(null);
    setShowForm(true);
  };

  const openEditForm = (agent: AiAgent) => {
    setEditingAgentId(agent.id);
    setDraft({
      scope: agent.scope,
      clientId: agent.clientId ?? '',
      name: agent.name,
      role: agent.role,
      purpose: agent.purpose,
      status: agent.status,
      provider: agent.provider ?? '',
      model: agent.model ?? '',
      channel: agent.channel ?? '',
      useCase: agent.useCase ?? '',
      capabilities: agent.capabilities,
      instructions: agent.instructions ?? '',
      knowledgeNotes: agent.knowledgeNotes ?? '',
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingAgentId(null);
    setDraft(emptyDraft(clients[0]?.id ?? ''));
  };

  const toggleCapability = (capability: AiAgentCapability) => {
    setDraft((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(capability)
        ? prev.capabilities.filter((c) => c !== capability)
        : [...prev.capabilities, capability],
    }));
  };

  const submitAgent = () => {
    const name = draft.name.trim();
    if (!name) return;
    if (draft.scope === 'client' && !draft.clientId) return;

    const payload = {
      scope: draft.scope,
      clientId: draft.scope === 'client' ? draft.clientId : null,
      name,
      role: draft.role.trim(),
      purpose: draft.purpose.trim(),
      status: draft.status,
      provider: draft.provider === '' ? null : draft.provider,
      model: draft.model.trim() || null,
      channel: draft.channel === '' ? null : draft.channel,
      useCase: draft.useCase === '' ? null : draft.useCase,
      capabilities: draft.capabilities,
      instructions: draft.instructions.trim() || null,
      knowledgeNotes: draft.knowledgeNotes.trim() || null,
    };

    if (editingAgentId) {
      updateAiAgent(editingAgentId, payload);
    } else {
      createAiAgent({ ...payload, dataSource: 'manual' });
    }

    const activeClient = clientFilter === 'all' || clientFilter === INTERNAL_FILTER ? undefined : clientFilter;
    setAgents(getAiAgents(activeClient));
    closeForm();
  };

  const handleStatusChange = (agentId: string, next: AiAgentStatus) => {
    setAiAgentStatus(agentId, next);
    const activeClient = clientFilter === 'all' || clientFilter === INTERNAL_FILTER ? undefined : clientFilter;
    setAgents(getAiAgents(activeClient));
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-os-dim">REKREATIVE INTELIGENCIA</div>
          <h1 className="mt-1 text-[25px] font-bold uppercase tracking-[0.06em] text-os-text">Agentes</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCreateForm}
            className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
          >
            Nuevo agente
          </button>
        </div>
      </div>

      {/* KPI summary */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Activos', value: String(summary.active) },
          { label: 'Borradores', value: String(summary.draft) },
          { label: 'Pausados', value: String(summary.paused) },
          { label: 'Configuración incompleta', value: String(summary.incompleteConfiguration) },
        ].map((tile) => (
          <div key={tile.label} className="border border-os-border bg-os-surface px-3 py-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">{tile.label}</div>
            <div className="mt-1.5 font-mono text-[18px] font-semibold text-os-text">{tile.value}</div>
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
                onClick={() => setStatusFilter(option.id as 'all' | AiAgentStatus)}
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
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Canal</label>
          <select
            value={channelFilter}
            onChange={(event) => setChannelFilter(event.target.value as 'all' | AiAgentChannel)}
            className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
          >
            {CHANNEL_FILTERS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim">Proveedor</label>
          <select
            value={providerFilter}
            onChange={(event) => setProviderFilter(event.target.value as 'all' | AiAgentProvider)}
            className="border border-os-border bg-os-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-os-text"
          >
            {PROVIDER_FILTERS.map((option) => (
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
            <option value={INTERNAL_FILTER}>Interno</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Agent cards */}
      {visibleAgents.length === 0 ? (
        <div className="border border-dashed border-os-border px-3 py-8 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
          No hay agentes en este segmento.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visibleAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              clientName={getClientNameForAiAgent(agent.clientId)}
              providerLogos={providerLogos}
              channelLogos={channelLogos}
              channelIconsLarge={channelIconsLarge}
              noChannelIcon={noChannelIcon}
              expanded={Boolean(expanded[agent.id])}
              onToggle={() => setExpanded((prev) => ({ ...prev, [agent.id]: !prev[agent.id] }))}
              onStatusChange={(next) => handleStatusChange(agent.id, next)}
              onEdit={() => openEditForm(agent)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-sm-t border border-os-border bg-os-surface p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold uppercase tracking-wide">{editingAgentId ? 'Editar agente' : 'Nuevo agente'}</h2>
              <button type="button" onClick={closeForm} className="font-mono text-[10px] uppercase tracking-wide text-os-dim hover:text-os-accent">
                cerrar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Ámbito</span>
                <div className="flex gap-1.5">
                  {(['client', 'internal'] as AiAgentScope[]).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => setDraft((prev) => ({ ...prev, scope, clientId: scope === 'internal' ? '' : prev.clientId }))}
                      className={`border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wide ${
                        draft.scope === scope ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim'
                      }`}
                    >
                      {scope === 'client' ? 'Cliente' : 'Interno'}
                    </button>
                  ))}
                </div>
              </div>

              {draft.scope === 'client' && (
                <label className="col-span-2">
                  <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Cliente</span>
                  <select
                    value={draft.clientId}
                    onChange={(event) => setDraft((prev) => ({ ...prev, clientId: event.target.value }))}
                    className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                  >
                    <option value="">Selecciona un cliente</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Nombre</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Rol</span>
                <input
                  value={draft.role}
                  onChange={(event) => setDraft((prev) => ({ ...prev, role: event.target.value }))}
                  placeholder="p. ej. Cualificación inicial de leads por WhatsApp"
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Propósito</span>
                <textarea
                  value={draft.purpose}
                  onChange={(event) => setDraft((prev) => ({ ...prev, purpose: event.target.value }))}
                  className="h-16 w-full resize-none border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Estado</span>
                <select
                  value={draft.status}
                  onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value as AiAgentStatus }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  {AI_AGENT_STATUS_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Proveedor</span>
                <select
                  value={draft.provider}
                  onChange={(event) => setDraft((prev) => ({ ...prev, provider: event.target.value as '' | AiAgentProvider }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  <option value="">Sin definir</option>
                  {AI_AGENT_PROVIDER_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Modelo</span>
                <input
                  value={draft.model}
                  onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))}
                  placeholder="p. ej. gpt-4o, claude-sonnet-5"
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Canal</span>
                <select
                  value={draft.channel}
                  onChange={(event) => setDraft((prev) => ({ ...prev, channel: event.target.value as '' | AiAgentChannel }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  <option value="">Sin definir</option>
                  {AI_AGENT_CHANNEL_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="col-span-1">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Caso de uso</span>
                <select
                  value={draft.useCase}
                  onChange={(event) => setDraft((prev) => ({ ...prev, useCase: event.target.value as '' | AiAgentUseCase }))}
                  className="w-full border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-os-text"
                >
                  <option value="">Sin definir</option>
                  {AI_AGENT_USE_CASE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="col-span-2 border-t border-os-border pt-3">
                <span className="mb-2 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Capacidades</span>
                <div className="flex flex-wrap gap-1.5">
                  {AI_AGENT_CAPABILITY_OPTIONS.map((option) => {
                    const on = draft.capabilities.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => toggleCapability(option.id)}
                        className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${
                          on ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim hover:border-os-border-strong'
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="col-span-2 border-t border-os-border pt-3">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Instrucciones</span>
                <textarea
                  value={draft.instructions}
                  onChange={(event) => setDraft((prev) => ({ ...prev, instructions: event.target.value }))}
                  placeholder="Qué debe hacer este agente, cómo debe comportarse, qué no debe hacer nunca..."
                  className="h-28 w-full resize-none border border-os-border bg-os-surface2 px-2 py-2 font-mono text-[11px] text-os-text outline-none"
                />
              </label>

              <label className="col-span-2">
                <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-wide text-os-dim">Notas de conocimiento</span>
                <textarea
                  value={draft.knowledgeNotes}
                  onChange={(event) => setDraft((prev) => ({ ...prev, knowledgeNotes: event.target.value }))}
                  placeholder="Qué contexto/información del cliente debería conocer este agente (opcional)"
                  className="h-16 w-full resize-none border border-os-border bg-os-surface2 px-2 py-2 text-sm text-os-text outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="border border-os-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-dim">
                Cancelar
              </button>
              <button type="button" onClick={submitAgent} className="border border-os-border bg-os-accent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-surface">
                {editingAgentId ? 'Guardar agente' : 'Crear agente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

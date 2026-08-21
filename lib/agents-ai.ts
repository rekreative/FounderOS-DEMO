import { getClients } from '@/lib/clients';

// AI agent configuration roster for REKREATIVE — NOT execution. This module
// deliberately does not call any LLM provider, does not persist run history,
// and does not integrate with FounderOS's own SQLite-backed /agents runtime
// (lib/agents/*). It answers "what agents exist, who owns them, are they
// configured well enough to use" — not "what did they do".

export const AI_AGENT_SCOPE_OPTIONS = [
  { id: 'client', label: 'Cliente' },
  { id: 'internal', label: 'Interno' },
] as const;
export type AiAgentScope = (typeof AI_AGENT_SCOPE_OPTIONS)[number]['id'];

export const AI_AGENT_STATUS_OPTIONS = [
  { id: 'active', label: 'Activo' },
  { id: 'paused', label: 'Pausado' },
  { id: 'draft', label: 'Borrador' },
] as const;
export type AiAgentStatus = (typeof AI_AGENT_STATUS_OPTIONS)[number]['id'];

// ── Configuration status — always derived, never persisted (see
// getAiAgentConfigurationStatus). Deliberately a separate vocabulary from
// AiAgentStatus, same discipline as lib/automations.ts's AutomationStatus vs
// AutomationHealth split — an "active" agent with blank instructions is
// still "incomplete", and a fully-configured "draft" agent is still
// "complete". Unlike Automations, there is no run history behind this:
// configurationStatus reflects field completeness only, never operational
// health/readiness — no real runtime exists yet, so that word is avoided
// entirely.
export const AI_AGENT_CONFIGURATION_STATUS_OPTIONS = [
  { id: 'complete', label: 'Configuración completa' },
  { id: 'incomplete', label: 'Configuración incompleta' },
] as const;
export type AiAgentConfigurationStatus = (typeof AI_AGENT_CONFIGURATION_STATUS_OPTIONS)[number]['id'];

export const AI_AGENT_PROVIDER_OPTIONS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'other', label: 'Otro' },
] as const;
export type AiAgentProvider = (typeof AI_AGENT_PROVIDER_OPTIONS)[number]['id'];

export const AI_AGENT_CHANNEL_OPTIONS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'crm', label: 'CRM' },
  { id: 'internal', label: 'Interno' },
  { id: 'multi_channel', label: 'Multicanal' },
] as const;
export type AiAgentChannel = (typeof AI_AGENT_CHANNEL_OPTIONS)[number]['id'];

export const AI_AGENT_USE_CASE_OPTIONS = [
  { id: 'lead_qualification', label: 'Cualificación de leads' },
  { id: 'follow_up', label: 'Seguimiento' },
  { id: 'faq', label: 'Preguntas frecuentes' },
  { id: 'summary', label: 'Resumen comercial' },
  { id: 'appointment_support', label: 'Soporte de citas' },
  { id: 'internal_reporting', label: 'Reporting interno' },
  { id: 'other', label: 'Otro' },
] as const;
export type AiAgentUseCase = (typeof AI_AGENT_USE_CASE_OPTIONS)[number]['id'];

export const AI_AGENT_CAPABILITY_OPTIONS = [
  { id: 'qualify_lead', label: 'Cualificar lead' },
  { id: 'summarize_lead', label: 'Resumir lead' },
  { id: 'answer_questions', label: 'Responder preguntas' },
  { id: 'follow_up', label: 'Seguimiento' },
  { id: 'appointment_support', label: 'Soporte de citas' },
  { id: 'crm_update', label: 'Actualizar CRM' },
  { id: 'knowledge_lookup', label: 'Consultar conocimiento' },
] as const;
export type AiAgentCapability = (typeof AI_AGENT_CAPABILITY_OPTIONS)[number]['id'];

/** 'demo' = seeded placeholder data, 'manual' = entered by hand in this UI.
 * Same honesty rule as lib/automations.ts's AutomationDataSource — never
 * imply this agent is actually wired to a live LLM/WhatsApp/CRM integration. */
export type AiAgentDataSource = 'demo' | 'manual';

export type AiAgent = {
  id: string;
  scope: AiAgentScope;
  /** Required when scope === 'client'; always null when scope === 'internal'. */
  clientId: string | null;

  name: string;
  role: string;
  purpose: string;

  status: AiAgentStatus;

  provider: AiAgentProvider | null;
  /** Free string — model names churn too fast for a controlled enum, and V1 never calls one. */
  model: string | null;

  channel: AiAgentChannel | null;
  useCase: AiAgentUseCase | null;
  capabilities: AiAgentCapability[];

  /** Single free-text field — a role/goal/rules/tone split is over-structuring a prompt nothing consumes yet. */
  instructions: string | null;
  /** Free-text scratch notes on what client/context knowledge this agent should draw on. Not a G-Brain link. */
  knowledgeNotes: string | null;

  createdAt: string;
  updatedAt: string;

  dataSource: AiAgentDataSource;
};

export type CreateAiAgentInput = {
  scope: AiAgentScope;
  clientId?: string | null;
  name: string;
  role?: string;
  purpose?: string;
  status?: AiAgentStatus;
  provider?: AiAgentProvider | null;
  model?: string | null;
  channel?: AiAgentChannel | null;
  useCase?: AiAgentUseCase | null;
  capabilities?: AiAgentCapability[];
  instructions?: string | null;
  knowledgeNotes?: string | null;
  dataSource?: AiAgentDataSource;
};

export type UpdateAiAgentInput = Partial<Omit<AiAgent, 'id' | 'createdAt'>>;

const STORAGE_KEY = 'rek_ai_agents_v1';

// ===== RAW STORAGE (kept private to this module) =====

function readStorage<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error(`Failed to parse ${key} from localStorage`, error);
    return [];
  }
}

function writeStorage<T>(key: string, value: T[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to write ${key} to localStorage`, error);
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

// ===== SEED / DEMO DATA =====
// Intentionally obvious REKREATIVE-style demo agents — replace with real
// provider-backed configuration later without touching this module's public
// API. Includes one deliberately incomplete draft to exercise the
// configuration status honestly (no fake "complete" agents, no fake
// activity history).

function seedDemoAiAgents(): AiAgent[] {
  const now = new Date();
  const daysAgo = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return d.toISOString();
  };

  return [
    {
      id: 'agent-lead-qualification',
      scope: 'client',
      clientId: 'client-acme',
      name: 'Agente de Cualificación de Leads',
      role: 'Cualificación inicial de leads entrantes por WhatsApp',
      purpose:
        'Responde al primer contacto de un lead de Meta Ads, hace preguntas de cualificación y decide su prioridad antes de pasarlo a comercial.',
      status: 'active',
      provider: 'openai',
      model: 'gpt-4o',
      channel: 'whatsapp',
      useCase: 'lead_qualification',
      capabilities: ['qualify_lead', 'answer_questions', 'crm_update'],
      instructions:
        'Eres el primer punto de contacto por WhatsApp para nuevos leads de Acme Co. Saluda, confirma interés, haz un máximo de 3 preguntas de cualificación (presupuesto, plazo, decisor) y clasifica el lead como frío/templado/caliente. Nunca prometas precios ni cierres una venta.',
      knowledgeNotes: 'Conoce el catálogo de servicios de Acme Co y su rango de presupuesto mensual (ver ficha de cliente).',
      createdAt: daysAgo(45),
      updatedAt: daysAgo(2),
      dataSource: 'demo',
    },
    {
      id: 'agent-seguimiento',
      scope: 'client',
      clientId: 'client-northwind',
      name: 'Agente de Seguimiento',
      role: 'Seguimiento de leads sin respuesta',
      purpose: 'Reactiva conversaciones de WhatsApp con leads que no han respondido en 48h con un mensaje de seguimiento no invasivo.',
      status: 'active',
      provider: 'openai',
      model: 'gpt-4o-mini',
      channel: 'whatsapp',
      useCase: 'follow_up',
      capabilities: ['follow_up', 'crm_update'],
      instructions:
        'Envía un único mensaje de seguimiento breve y cordial a leads de Northwind Ltd que no han respondido en 48 horas. Si no hay respuesta tras el seguimiento, marca el lead como "sin respuesta" en el CRM.',
      knowledgeNotes: null,
      createdAt: daysAgo(30),
      updatedAt: daysAgo(5),
      dataSource: 'demo',
    },
    {
      id: 'agent-resumen-comercial',
      scope: 'internal',
      clientId: null,
      name: 'Agente de Resumen Comercial',
      role: 'Resumen diario de actividad comercial para el equipo interno',
      purpose: 'Genera un resumen diario de leads nuevos, cualificados y convertidos en el CRM para el equipo comercial de REKREATIVE.',
      status: 'active',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      channel: 'crm',
      useCase: 'summary',
      capabilities: ['summarize_lead'],
      instructions:
        'Cada mañana, resume la actividad del CRM del día anterior: leads nuevos, cambios de etapa y citas confirmadas. Formato breve, en español, orientado a acción.',
      knowledgeNotes: 'Debe conocer las etapas del pipeline de Leads V1 (nuevo, contactado, cualificado, cita, convertido).',
      createdAt: daysAgo(20),
      updatedAt: daysAgo(1),
      dataSource: 'demo',
    },
    {
      id: 'agent-draft-instagram',
      scope: 'client',
      clientId: 'client-lumen',
      name: 'Agente de Respuesta Instagram (borrador)',
      role: '',
      purpose: 'Responder comentarios y DMs frecuentes en Instagram.',
      status: 'draft',
      provider: null,
      model: null,
      channel: 'instagram',
      useCase: null,
      capabilities: [],
      instructions: null,
      knowledgeNotes: null,
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
      dataSource: 'demo',
    },
  ];
}

// ===== STORE INITIALIZATION =====

export function initializeAiAgentsStoreIfNeeded(): AiAgent[] {
  if (typeof window === 'undefined') {
    return seedDemoAiAgents();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedDemoAiAgents();
    writeStorage(STORAGE_KEY, seeded);
    return seeded;
  }

  try {
    const parsed = JSON.parse(raw);
    const existing: AiAgent[] = Array.isArray(parsed) ? parsed : [];
    return existing.length ? existing : seedDemoAiAgents();
  } catch (error) {
    console.error('Failed to parse ai-agents from localStorage; leaving existing store intact.', error);
    return seedDemoAiAgents();
  }
}

// ===== READ =====

export function getAiAgents(clientId?: string): AiAgent[] {
  const agents = readStorage<AiAgent>(STORAGE_KEY);
  const result = !clientId ? agents : agents.filter((agent) => agent.clientId === clientId);
  return result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getAiAgentById(id: string): AiAgent | null {
  return readStorage<AiAgent>(STORAGE_KEY).find((agent) => agent.id === id) ?? null;
}

// ===== WRITE =====

export function createAiAgent(input: CreateAiAgentInput): AiAgent {
  if (input.scope === 'client') {
    if (!input.clientId) {
      throw new Error('A client-scoped agent requires a clientId');
    }
    const clientExists = getClients().some((client) => client.id === input.clientId);
    if (!clientExists) {
      throw new Error('Cannot create agent for a missing client id');
    }
  }

  const now = isoNow();
  const created: AiAgent = {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scope: input.scope,
    clientId: input.scope === 'client' ? input.clientId ?? null : null,
    name: input.name.trim(),
    role: input.role?.trim() || '',
    purpose: input.purpose?.trim() || '',
    status: input.status ?? 'draft',
    provider: input.provider ?? null,
    model: input.model?.trim() || null,
    channel: input.channel ?? null,
    useCase: input.useCase ?? null,
    capabilities: input.capabilities ?? [],
    instructions: input.instructions?.trim() || null,
    knowledgeNotes: input.knowledgeNotes?.trim() || null,
    createdAt: now,
    updatedAt: now,
    dataSource: input.dataSource ?? 'manual',
  };

  const agents = readStorage<AiAgent>(STORAGE_KEY);
  writeStorage(STORAGE_KEY, [created, ...agents]);
  return created;
}

export function updateAiAgent(id: string, patch: UpdateAiAgentInput): AiAgent | null {
  const agents = readStorage<AiAgent>(STORAGE_KEY);
  const index = agents.findIndex((agent) => agent.id === id);
  if (index === -1) return null;

  const merged: AiAgent = { ...agents[index], ...patch };

  if (merged.scope === 'client') {
    if (!merged.clientId) {
      throw new Error('A client-scoped agent requires a clientId');
    }
    const clientExists = getClients().some((client) => client.id === merged.clientId);
    if (!clientExists) {
      throw new Error('Cannot move agent to a missing client id');
    }
  } else {
    merged.clientId = null;
  }

  const updated: AiAgent = { ...merged, updatedAt: isoNow() };
  agents[index] = updated;
  writeStorage(STORAGE_KEY, agents);
  return updated;
}

export function setAiAgentStatus(id: string, status: AiAgentStatus): AiAgent | null {
  return updateAiAgent(id, { status });
}

// ===== DERIVED (never persisted) =====

/** Configuration status — always computed from required-field presence,
 * never stored. Distinct from AiAgentStatus (see the comment on
 * AI_AGENT_CONFIGURATION_STATUS_OPTIONS above): a paused/draft agent can
 * still be "complete", and an "active" agent with blanked-out instructions
 * is still "incomplete". There is no run data involved — unlike
 * lib/automations.ts's getAutomationHealth, this needs none, since no real
 * runtime exists yet. Deliberately not called "readiness" — that word
 * implies operational health, which this module never claims. */
export function getAiAgentConfigurationStatus(
  agent: Pick<AiAgent, 'name' | 'role' | 'provider' | 'model' | 'instructions' | 'scope' | 'clientId'>,
): AiAgentConfigurationStatus {
  const hasName = agent.name.trim().length > 0;
  const hasRole = agent.role.trim().length > 0;
  const hasProvider = Boolean(agent.provider);
  const hasModel = Boolean(agent.model && agent.model.trim().length > 0);
  const hasInstructions = Boolean(agent.instructions && agent.instructions.trim().length > 0);
  const hasScope = agent.scope === 'internal' || Boolean(agent.clientId);
  return hasName && hasRole && hasProvider && hasModel && hasInstructions && hasScope ? 'complete' : 'incomplete';
}

export type AiAgentsSummary = {
  active: number;
  draft: number;
  paused: number;
  /** Always derived from getAiAgentConfigurationStatus — never persisted. */
  incompleteConfiguration: number;
};

/** Aggregate KPI totals over a set of agents. */
export function summarizeAiAgents(agents: AiAgent[]): AiAgentsSummary {
  return {
    active: agents.filter((agent) => agent.status === 'active').length,
    draft: agents.filter((agent) => agent.status === 'draft').length,
    paused: agents.filter((agent) => agent.status === 'paused').length,
    incompleteConfiguration: agents.filter((agent) => getAiAgentConfigurationStatus(agent) === 'incomplete').length,
  };
}

// ===== LABELS =====

/** See lib/automations.ts's getClientNameForAutomation — same pattern: pass
 *  the canonical PostgreSQL `clients` list when the caller has one loaded. */
export function getClientNameForAiAgent(
  clientId: string | null,
  clients: { id: string; name: string }[] = getClients(),
): string {
  if (!clientId) return 'Interno';
  const client = clients.find((item) => item.id === clientId);
  return client?.name ?? 'Cliente desconocido';
}

export function getAiAgentStatusLabel(status: AiAgentStatus): string {
  return AI_AGENT_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}

export function getAiAgentScopeLabel(scope: AiAgentScope): string {
  return AI_AGENT_SCOPE_OPTIONS.find((option) => option.id === scope)?.label ?? scope;
}

export function getAiAgentConfigurationStatusLabel(status: AiAgentConfigurationStatus): string {
  return AI_AGENT_CONFIGURATION_STATUS_OPTIONS.find((option) => option.id === status)?.label ?? status;
}

export function getAiAgentProviderLabel(provider: AiAgentProvider): string {
  return AI_AGENT_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ?? provider;
}

export function getAiAgentChannelLabel(channel: AiAgentChannel): string {
  return AI_AGENT_CHANNEL_OPTIONS.find((option) => option.id === channel)?.label ?? channel;
}

export function getAiAgentUseCaseLabel(useCase: AiAgentUseCase): string {
  return AI_AGENT_USE_CASE_OPTIONS.find((option) => option.id === useCase)?.label ?? useCase;
}

export function getAiAgentCapabilityLabel(capability: AiAgentCapability): string {
  return AI_AGENT_CAPABILITY_OPTIONS.find((option) => option.id === capability)?.label ?? capability;
}

import { describe, it, expect } from 'vitest';
import {
  AI_AGENT_CAPABILITY_OPTIONS,
  createAiAgent,
  getAiAgentCapabilityLabel,
  getAiAgentChannelLabel,
  getAiAgentConfigurationStatus,
  getAiAgentConfigurationStatusLabel,
  getAiAgentProviderLabel,
  getAiAgentScopeLabel,
  getAiAgentStatusLabel,
  getAiAgentUseCaseLabel,
  initializeAiAgentsStoreIfNeeded,
  summarizeAiAgents,
  type AiAgent,
} from '@/lib/agents-ai';

// Same rationale as tests/automations.test.ts: this suite runs under vitest's
// `node` environment (no window/localStorage), exactly like lib/clients.ts,
// lib/leads.ts, lib/meta-ads.ts, and lib/automations.ts. What IS testable in
// node are the pure derivation/label helpers and the SSR-safe fallbacks; CRUD
// against localStorage needs a browser and is exercised by manual verification.

type ConfigurationStatusInput = Pick<AiAgent, 'name' | 'role' | 'provider' | 'model' | 'instructions' | 'scope' | 'clientId'>;

function baseAgent(overrides: Partial<ConfigurationStatusInput> = {}): ConfigurationStatusInput {
  return {
    name: 'Agente de prueba',
    role: 'Rol de prueba',
    provider: 'openai',
    model: 'gpt-4o',
    instructions: 'Instrucciones de prueba',
    scope: 'internal',
    clientId: null,
    ...overrides,
  };
}

describe('getAiAgentConfigurationStatus', () => {
  it('is complete when all required fields are present and scope is internal', () => {
    expect(getAiAgentConfigurationStatus(baseAgent())).toBe('complete');
  });

  it('is complete when scope is client and clientId is set', () => {
    expect(getAiAgentConfigurationStatus(baseAgent({ scope: 'client', clientId: 'client-acme' }))).toBe('complete');
  });

  it('is incomplete when scope is client but clientId is missing', () => {
    expect(getAiAgentConfigurationStatus(baseAgent({ scope: 'client', clientId: null }))).toBe('incomplete');
  });

  it('is incomplete when instructions are missing', () => {
    expect(getAiAgentConfigurationStatus(baseAgent({ instructions: null }))).toBe('incomplete');
  });

  it('is incomplete when provider is missing', () => {
    expect(getAiAgentConfigurationStatus(baseAgent({ provider: null }))).toBe('incomplete');
  });

  it('is incomplete when model is missing', () => {
    expect(getAiAgentConfigurationStatus(baseAgent({ model: null }))).toBe('incomplete');
  });

  it('is incomplete when role is blank', () => {
    expect(getAiAgentConfigurationStatus(baseAgent({ role: '' }))).toBe('incomplete');
  });

  it('is incomplete when name is blank', () => {
    expect(getAiAgentConfigurationStatus(baseAgent({ name: '' }))).toBe('incomplete');
  });

  it('does not derive configuration status from status — a draft with all fields filled is still complete', () => {
    // status is intentionally not part of this Pick: configuration status and
    // lifecycle status are separate vocabularies, same discipline as
    // lib/automations.ts's AutomationStatus vs AutomationHealth split.
    expect(getAiAgentConfigurationStatus(baseAgent())).toBe('complete');
  });
});

function fullAgent(overrides: Partial<AiAgent> = {}): AiAgent {
  return {
    id: 'agent-x',
    scope: 'internal',
    clientId: null,
    name: 'Agente de prueba',
    role: 'Rol de prueba',
    purpose: '',
    status: 'active',
    provider: 'openai',
    model: 'gpt-4o',
    channel: null,
    useCase: null,
    capabilities: [],
    instructions: 'Instrucciones de prueba',
    knowledgeNotes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    dataSource: 'manual',
    ...overrides,
  };
}

describe('summarizeAiAgents', () => {
  it('counts by status and by incomplete configuration — never by client', () => {
    const agents = [
      fullAgent({ status: 'active' }),
      fullAgent({ status: 'active', role: '' }), // incomplete: missing role
      fullAgent({ status: 'draft' }),
      fullAgent({ status: 'paused', provider: null }), // incomplete: missing provider
    ];
    expect(summarizeAiAgents(agents)).toEqual({ active: 2, draft: 1, paused: 1, incompleteConfiguration: 2 });
  });

  it('returns zeros for an empty list', () => {
    expect(summarizeAiAgents([])).toEqual({ active: 0, draft: 0, paused: 0, incompleteConfiguration: 0 });
  });

  it('demo seed data has exactly one agent with incomplete configuration', () => {
    const seeded = initializeAiAgentsStoreIfNeeded();
    expect(summarizeAiAgents(seeded).incompleteConfiguration).toBe(1);
  });
});

describe('label helpers', () => {
  it('resolve known ids to human labels', () => {
    expect(getAiAgentStatusLabel('active')).toBe('Activo');
    expect(getAiAgentScopeLabel('internal')).toBe('Interno');
    expect(getAiAgentConfigurationStatusLabel('incomplete')).toBe('Configuración incompleta');
    expect(getAiAgentConfigurationStatusLabel('complete')).toBe('Configuración completa');
    expect(getAiAgentProviderLabel('anthropic')).toBe('Anthropic');
    expect(getAiAgentChannelLabel('whatsapp')).toBe('WhatsApp');
    expect(getAiAgentUseCaseLabel('lead_qualification')).toBe('Cualificación de leads');
    expect(getAiAgentCapabilityLabel('qualify_lead')).toBe('Cualificar lead');
  });

  it('falls back to the raw id for an unrecognized value rather than throwing', () => {
    expect(getAiAgentChannelLabel('carrier_pigeon' as never)).toBe('carrier_pigeon');
  });
});

describe('capability enum', () => {
  it('contains exactly the controlled REKREATIVE capability set', () => {
    expect(AI_AGENT_CAPABILITY_OPTIONS.map((o) => o.id)).toEqual([
      'qualify_lead',
      'summarize_lead',
      'answer_questions',
      'follow_up',
      'appointment_support',
      'crm_update',
      'knowledge_lookup',
    ]);
  });
});

describe('server-side (no window) behavior', () => {
  it('initializeAiAgentsStoreIfNeeded falls back to in-memory seed data', () => {
    const seeded = initializeAiAgentsStoreIfNeeded();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((a) => a.dataSource === 'demo')).toBe(true);
  });

  it('seed data includes at least one deliberately incomplete draft agent', () => {
    const seeded = initializeAiAgentsStoreIfNeeded();
    const incomplete = seeded.filter((a) => getAiAgentConfigurationStatus(a) === 'incomplete');
    expect(incomplete.length).toBeGreaterThan(0);
  });

  it('createAiAgent rejects a client-scoped agent with a missing client id (client list is empty without window)', () => {
    expect(() =>
      createAiAgent({
        scope: 'client',
        clientId: 'client-does-not-exist',
        name: 'Test agent',
      }),
    ).toThrow('Cannot create agent for a missing client id');
  });

  it('createAiAgent rejects a client-scoped agent with no client id at all', () => {
    expect(() =>
      createAiAgent({
        scope: 'client',
        name: 'Test agent',
      }),
    ).toThrow('A client-scoped agent requires a clientId');
  });
});

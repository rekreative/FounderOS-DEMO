'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getClientById, initializeStoreIfNeeded, Client, updateClient, deleteClient, getClientNotes, updateClientNotes, getClientStatusLabel } from '@/lib/clients';
import { getLeads, initializeLeadsStoreIfNeeded, type Lead } from '@/lib/leads';
import { getCampaigns, initializeMetaCampaignsStoreIfNeeded, type MetaCampaign } from '@/lib/meta-ads';
import { getAutomations, initializeAutomationsStoreIfNeeded, summarizeAutomations, type Automation } from '@/lib/automations';
import { getAiAgents, initializeAiAgentsStoreIfNeeded, summarizeAiAgents, type AiAgent } from '@/lib/agents-ai';
import { getIntegrationConnections, initializeIntegrationConnectionsStoreIfNeeded, type IntegrationConnection } from '@/lib/integration-connections';
import {
  getClientIntegrationRequirements,
  initializeClientIntegrationRequirementsStoreIfNeeded,
  summarizeClientOnboarding,
  type ClientIntegrationRequirement,
} from '@/lib/client-integration-requirements';
import { getRevenueRecords, initializeResultsStoreIfNeeded, sumAttributedRevenue, type RevenueRecord } from '@/lib/results';
import { getContentItems, initializeContentStoreIfNeeded, summarizeContentItems, type ContentItem } from '@/lib/content-items';
import { ClientsForm, type NewClientInput } from '@/components/ClientsForm';
import { ClientOverviewPanel } from '@/components/ClientOverviewPanel';
import { ClientMetaAdsPanel } from '@/components/ClientMetaAdsPanel';
import { ClientLeadsPanel } from '@/components/ClientLeadsPanel';
import { ClientAutomationsPanel } from '@/components/ClientAutomationsPanel';
import { ClientAgentsPanel } from '@/components/ClientAgentsPanel';
import { ClientIntegrationsPanel } from '@/components/ClientIntegrationsPanel';
import { ClientContentPanel } from '@/components/ClientContentPanel';
import { ClientResultsPreview } from '@/components/ClientResultsPreview';
import { ClientNotesPanel } from '@/components/ClientNotesPanel';
import Link from 'next/link';

type TabKey = 'overview' | 'meta-ads' | 'leads' | 'automations' | 'agents' | 'integrations' | 'content' | 'results' | 'notes';

const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Resumen',
  'meta-ads': 'Meta Ads',
  leads: 'Leads',
  automations: 'Automatizaciones',
  agents: 'Agentes IA',
  integrations: 'Integraciones',
  content: 'Contenido',
  results: 'Resultados',
  notes: 'Notas',
};

const CLOSED_LEAD_STAGES = new Set(['converted', 'disqualified', 'no_response']);

export default function ClientDetailPage({ params }: { params: { clientId: string } }) {
  const clientId = params?.clientId ?? '';
  const [client, setClient] = useState<Client | null>(null);
  const [notes, setNotes] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const router = useRouter();

  // Client-scoped module data — all reused from each module's own global
  // store, filtered by clientId. No client-specific storage is created here.
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [allConnections, setAllConnections] = useState<IntegrationConnection[]>([]);
  const [requirements, setRequirements] = useState<ClientIntegrationRequirement[]>([]);
  const [revenueRecords, setRevenueRecords] = useState<RevenueRecord[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);

  useEffect(() => {
    initializeStoreIfNeeded();
    initializeLeadsStoreIfNeeded();
    initializeMetaCampaignsStoreIfNeeded();
    initializeAutomationsStoreIfNeeded();
    initializeAiAgentsStoreIfNeeded();
    initializeIntegrationConnectionsStoreIfNeeded();
    initializeClientIntegrationRequirementsStoreIfNeeded();
    initializeResultsStoreIfNeeded();
    initializeContentStoreIfNeeded();

    const c = getClientById(clientId);
    setClient(c);
    if (c) {
      setNotes(getClientNotes(c.id));
    }

    setLeads(getLeads(clientId));
    setCampaigns(getCampaigns(clientId));
    setAutomations(getAutomations(clientId));
    setAgents(getAiAgents(clientId));
    setAllConnections(getIntegrationConnections());
    setRequirements(getClientIntegrationRequirements(clientId));
    setRevenueRecords(getRevenueRecords(clientId));
    setContentItems(getContentItems(clientId));
  }, [clientId]);

  const leadCounts = useMemo(
    () => ({
      total: leads.length,
      open: leads.filter((lead) => !CLOSED_LEAD_STAGES.has(lead.stage)).length,
    }),
    [leads],
  );

  const metaAdsCounts = useMemo(
    () => ({ total: campaigns.length, active: campaigns.filter((c) => c.status === 'active').length }),
    [campaigns],
  );

  const automationsSummary = useMemo(() => summarizeAutomations(automations), [automations]);
  const agentsSummary = useMemo(() => summarizeAiAgents(agents), [agents]);
  const contentSummary = useMemo(() => summarizeContentItems(contentItems), [contentItems]);

  const relevantConnectionsForOnboarding = useMemo(
    () => allConnections.filter((c) => c.clientId === clientId || c.scope === 'internal'),
    [allConnections, clientId],
  );
  const onboardingSummary = useMemo(
    () => summarizeClientOnboarding(clientId, requirements, relevantConnectionsForOnboarding),
    [clientId, requirements, relevantConnectionsForOnboarding],
  );

  const attributedRevenueAllTime = useMemo(() => sumAttributedRevenue(revenueRecords), [revenueRecords]);

  if (!client) {
    return (
      <div className="p-4">
        <div className="mb-4">
          <Link href="/clients" className="text-os-dim">← Volver a clientes</Link>
        </div>
        <div className="text-os-dim">Cliente no encontrado.</div>
      </div>
    );
  }

  function handleEditClient(data: NewClientInput) {
    const updated = updateClient(clientId, data);
    if (updated) {
      setClient(updated);
      setShowEditForm(false);
    }
  }

  function handleConfirmDelete() {
    const success = deleteClient(clientId);
    if (success) {
      router.push('/clients');
    }
  }

  function handleSaveNotes() {
    updateClientNotes(clientId, notes);
    setNotesDirty(false);
  }

  const hasRelatedRecords =
    leads.length > 0 ||
    campaigns.length > 0 ||
    automations.length > 0 ||
    agents.length > 0 ||
    requirements.length > 0 ||
    revenueRecords.length > 0 ||
    contentItems.length > 0;

  return (
    <div className="p-4">
      {/* Header — client identity always visible regardless of active tab */}
      <div className="mb-6 border-b border-os-border pb-4">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <Link href="/clients" className="text-os-dim text-sm mb-2 block">← Volver a clientes</Link>
            <h1 className="text-2xl font-semibold">{client.name}</h1>
            <div className="text-os-dim text-sm">{client.sector} · {client.service}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowEditForm(true)}
              className="px-3 py-1 border border-os-border hover:bg-os-surface2 transition-colors"
            >
              Editar
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="px-3 py-1 border border-os-err text-os-err hover:bg-os-surface2 transition-colors"
            >
              Eliminar
            </button>
          </div>
        </div>

        {/* Client metadata grid */}
        <div className="grid grid-cols-4 gap-3">
          <div className="p-2 border border-os-border bg-os-surface2 text-sm">
            <div className="text-[11px] text-os-dim uppercase tracking-wide">Estado</div>
            <div className="mt-1 font-mono">{getClientStatusLabel(client.status)}</div>
          </div>
          <div className="p-2 border border-os-border bg-os-surface2 text-sm">
            <div className="text-[11px] text-os-dim uppercase tracking-wide">Presupuesto Meta</div>
            <div className="mt-1 font-mono">{Math.round(client.metaBudgetMonthly).toLocaleString('es-ES')} €</div>
          </div>
          <div className="p-2 border border-os-border bg-os-surface2 text-sm">
            <div className="text-[11px] text-os-dim uppercase tracking-wide">Fecha de inicio</div>
            <div className="mt-1">{client.startDate}</div>
          </div>
          <div className="p-2 border border-os-border bg-os-surface2 text-sm">
            <div className="text-[11px] text-os-dim uppercase tracking-wide">Responsable</div>
            <div className="mt-1">{client.owner}</div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <nav className="mb-6 border-b border-os-border">
        <ul className="flex gap-4 text-sm font-mono text-os-dim">
          {(['overview', 'meta-ads', 'leads', 'automations', 'agents', 'integrations', 'content', 'results', 'notes'] as TabKey[]).map((tab) => (
            <li
              key={tab}
              className={`pb-2 cursor-pointer transition-colors ${
                activeTab === tab ? 'text-os-accent border-b border-os-accent -mb-[1px]' : 'hover:text-os-muted'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </li>
          ))}
        </ul>
      </nav>

      {/* Tab Content */}
      <section>
        {activeTab === 'overview' && (
          <ClientOverviewPanel
            client={client}
            leadCounts={leadCounts}
            metaAdsCounts={metaAdsCounts}
            automationsSummary={automationsSummary}
            agentsSummary={agentsSummary}
            onboardingSummary={onboardingSummary}
            contentSummary={contentSummary}
            attributedRevenueAllTime={attributedRevenueAllTime}
            onOpenTab={(tab) => setActiveTab(tab)}
          />
        )}

        {activeTab === 'meta-ads' && <ClientMetaAdsPanel campaigns={campaigns} />}

        {activeTab === 'leads' && <ClientLeadsPanel leads={leads} />}

        {activeTab === 'automations' && <ClientAutomationsPanel automations={automations} />}

        {activeTab === 'agents' && <ClientAgentsPanel agents={agents} />}

        {activeTab === 'integrations' && (
          <ClientIntegrationsPanel clientId={clientId} requirements={requirements} allConnections={allConnections} />
        )}

        {activeTab === 'content' && (
          <ClientContentPanel
            clientId={clientId}
            items={contentItems}
            onContentChanged={() => setContentItems(getContentItems(clientId))}
          />
        )}

        {activeTab === 'results' && (
          <ClientResultsPreview
            clientId={client.id}
            clientName={client.name}
            attributedRevenueAllTime={attributedRevenueAllTime}
          />
        )}

        {activeTab === 'notes' && (
          <ClientNotesPanel
            notes={notes}
            notesDirty={notesDirty}
            onChange={(value) => {
              setNotes(value);
              setNotesDirty(true);
            }}
            onSave={handleSaveNotes}
          />
        )}
      </section>

      {/* Edit Client Modal */}
      {showEditForm && (
        <ClientsForm
          mode="edit"
          initialData={client}
          onCancel={() => setShowEditForm(false)}
          onUpdate={handleEditClient}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative w-full max-w-md bg-os-surface border border-os-border p-4">
            <h3 className="mb-3 text-lg font-semibold">Eliminar cliente</h3>
            <p className="text-sm text-os-dim mb-4">
              ¿Seguro que quieres eliminar a <strong>{client.name}</strong>? Esta acción no se puede deshacer.
            </p>
            {hasRelatedRecords && (
              <p className="text-sm text-os-warn mb-4 border border-os-border bg-os-surface2 px-3 py-2">
                Este cliente tiene leads, campañas, automatizaciones, agentes, integraciones o ingresos registrados.
                Esos registros no se eliminarán automáticamente y quedarán asociados a un cliente inexistente.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-3 py-1 border border-os-border hover:bg-os-surface2"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3 py-1 border border-os-err bg-os-err/10 text-os-err hover:bg-os-err/20"
              >
                Eliminar cliente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

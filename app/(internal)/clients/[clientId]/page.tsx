'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
// Client identity is canonical PostgreSQL now (lib/api/clients.ts). Notes
// stay localStorage in this pass — they were never named as a migrating
// entity — so getClientNotes/updateClientNotes/getClientStatusLabel (a pure
// label lookup, no storage) still come from lib/clients.ts.
import { Client, getClientNotes, getClientStatusLabel, updateClientNotes } from '@/lib/clients';
import { deleteClient, getClientById, updateClient } from '@/lib/api/clients';
import { getClientOpsSnapshot as fetchClientOpsSnapshot } from '@/lib/api/ops-status';
import { countObservedAutomations, type OpsClientSnapshot } from '@/lib/ops-status';
import { getLeads, type Lead } from '@/lib/api/leads';
import { countActiveMetaCampaigns, getMetaAdsCampaigns, type MetaAdsCampaignsResponse } from '@/lib/api/meta-ads';
import { getAutomations, initializeAutomationsStoreIfNeeded, summarizeAutomations, type Automation } from '@/lib/automations';
import { getAiAgents, initializeAiAgentsStoreIfNeeded, summarizeAiAgents, type AiAgent } from '@/lib/agents-ai';
import type { IntegrationConnection } from '@/lib/integration-connections';
import { getIntegrationConnections } from '@/lib/api/integration-connections';
import {
  getClientIntegrationRequirements,
  initializeClientIntegrationRequirementsStoreIfNeeded,
  summarizeClientOnboarding,
  type ClientIntegrationRequirement,
} from '@/lib/client-integration-requirements';
import { sumAttributedRevenue, type RevenueRecord } from '@/lib/results';
import { getRevenueRecords } from '@/lib/api/revenue-records';
import { getContentItems, initializeContentStoreIfNeeded, summarizeContentItems, type ContentItem } from '@/lib/content-items';
import type { KnowledgeEntry } from '@/lib/knowledge-entries';
import { getKnowledgeEntries } from '@/lib/api/knowledge-entries';
import { ClientsForm, type NewClientInput } from '@/components/ClientsForm';
import { ClientOverviewPanel } from '@/components/ClientOverviewPanel';
import { ClientMetaAdsPanel } from '@/components/ClientMetaAdsPanel';
import { ClientLeadsPanel } from '@/components/ClientLeadsPanel';
import { ClientAutomationsPanel } from '@/components/ClientAutomationsPanel';
import { ClientAgentsPanel } from '@/components/ClientAgentsPanel';
import { ClientIntegrationsPanel } from '@/components/ClientIntegrationsPanel';
import { ClientContentPanel } from '@/components/ClientContentPanel';
import { ClientKnowledgePanel } from '@/components/ClientKnowledgePanel';
import { ClientResultsPreview } from '@/components/ClientResultsPreview';
import { ClientNotesPanel } from '@/components/ClientNotesPanel';
import Link from 'next/link';

type TabKey = 'overview' | 'meta-ads' | 'leads' | 'automations' | 'agents' | 'integrations' | 'content' | 'knowledge' | 'results' | 'notes';

const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Resumen',
  'meta-ads': 'Meta Ads',
  leads: 'Leads',
  automations: 'Automatizaciones',
  agents: 'Agentes IA',
  integrations: 'Integraciones',
  content: 'Contenido',
  knowledge: 'Conocimiento',
  results: 'Resultados',
  notes: 'Notas',
};

const CLOSED_LEAD_STAGES = new Set(['converted', 'disqualified', 'no_response']);

// Display-only formatting, matching the approved /clients list
// (components/ClientsList.tsx) so the two surfaces never disagree on how a
// budget/date reads. Explicit useGrouping avoids a runtime quirk where bare
// .toLocaleString('es-ES') silently drops the thousands separator. Applied
// once here at the shared Client Workspace header so every tab inherits the
// same formatting; never touches the stored client value.
function formatHeaderBudget(value: number): string {
  return `${Math.round(value).toLocaleString('es-ES', { useGrouping: true })} €`;
}

// startDate is stored date-only ('YYYY-MM-DD'); UTC keeps the displayed day
// from shifting with the viewer's local timezone.
function formatHeaderStartDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

export default function ClientDetailPage({ params }: { params: { clientId: string } }) {
  const clientId = params?.clientId ?? '';
  const [client, setClient] = useState<Client | null>(null);
  // Distinguishes "still loading" from "genuinely not found" — without this
  // the not-found screen would flash before the PostgreSQL fetch resolves.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const router = useRouter();

  // Client-scoped module data — all reused from each module's own global
  // store, filtered by clientId. No client-specific storage is created here.
  const [leads, setLeads] = useState<Lead[]>([]);
  // Meta Ads Real V1 — ONE real fetch (GET /api/meta-ads/campaigns), shared
  // by both the Overview summary card (metaAdsCounts, derived below) and
  // the Meta Ads tab (ClientMetaAdsPanel, which renders this same response
  // as a prop instead of fetching its own copy) — never the demo/localStorage
  // MetaCampaign store, and never two competing queries for the same data.
  const [metaAdsData, setMetaAdsData] = useState<MetaAdsCampaignsResponse | null>(null);
  const [metaAdsError, setMetaAdsError] = useState<string | null>(null);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [allConnections, setAllConnections] = useState<IntegrationConnection[]>([]);
  // Module-specific loading/error for the Integraciones tab — kept separate
  // from the page-wide fatal `loadError` (client identity/leads) so an
  // integration-connections failure never hides otherwise-healthy client
  // data on every other tab.
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<ClientIntegrationRequirement[]>([]);
  const [revenueRecords, setRevenueRecords] = useState<RevenueRecord[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);

  // Real per-client operational evidence (Client Truth Alignment V1) — ONE
  // fetch per client, shared by the Automations tab, the AI Agents tab, and
  // the Overview summary tiles, so all three read the exact same snapshot
  // and can never disagree with each other.
  const [clientOpsSnapshot, setClientOpsSnapshot] = useState<OpsClientSnapshot | null>(null);
  const [clientOpsError, setClientOpsError] = useState<string | null>(null);

  useEffect(() => {
    // Client identity + Leads: canonical PostgreSQL, async, cancellation-guarded.
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([getClientById(clientId), getLeads({ clientId })])
      .then(([loadedClient, clientLeads]) => {
        if (cancelled) return;
        setClient(loadedClient);
        setLeads(clientLeads);
        if (loadedClient) setNotes(getClientNotes(loadedClient.id));
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'No se pudo cargar el cliente.');
        setLoading(false);
      });

    setMetaAdsData(null);
    setMetaAdsError(null);
    getMetaAdsCampaigns({ clientId, preset: 'all' })
      .then((response) => {
        if (!cancelled) setMetaAdsData(response);
      })
      .catch((err: unknown) => {
        if (!cancelled) setMetaAdsError(err instanceof Error ? err.message : 'No se pudo cargar Meta Ads.');
      });

    // Everything else stays localStorage in this pass — unchanged, synchronous.
    initializeAutomationsStoreIfNeeded();
    initializeAiAgentsStoreIfNeeded();
    initializeClientIntegrationRequirementsStoreIfNeeded();
    initializeContentStoreIfNeeded();

    setAutomations(getAutomations(clientId));
    setAgents(getAiAgents(clientId));
    setRequirements(getClientIntegrationRequirements(clientId));
    setContentItems(getContentItems(clientId));

    // Integration connections: canonical PostgreSQL (Connections/Secrets V1).
    // Fetches every ACTIVE connection (not scoped to clientId) — onboarding
    // matching needs this client's own connections AND every shared internal
    // connection (see relevantConnectionsForOnboarding below), same contract
    // the old localStorage read had. connectionsLoading/connectionsError are
    // module-specific (not the page-wide loadError) so a failure here is
    // visible in the Integraciones tab without breaking the rest of the
    // client workspace.
    setAllConnections([]);
    setConnectionsLoading(true);
    setConnectionsError(null);
    getIntegrationConnections()
      .then((connections) => {
        if (!cancelled) setAllConnections(connections);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('Failed to load integration connections', error);
        setConnectionsError(error instanceof Error ? error.message : 'No se pudieron cargar las integraciones.');
      })
      .finally(() => {
        if (!cancelled) setConnectionsLoading(false);
      });

    // Manual revenue ledger: canonical PostgreSQL (Results Manual Revenue V1).
    setRevenueRecords([]);
    getRevenueRecords(clientId)
      .then((records) => {
        if (!cancelled) setRevenueRecords(records);
      })
      .catch((error: unknown) => {
        console.error('Failed to load revenue records', error);
      });

    // G-Brain: canonical PostgreSQL (G-Brain Postgres V1).
    setKnowledgeEntries([]);
    getKnowledgeEntries(clientId)
      .then((entries) => {
        if (!cancelled) setKnowledgeEntries(entries);
      })
      .catch((error: unknown) => {
        console.error('Failed to load knowledge entries', error);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;
    setClientOpsSnapshot(null);
    setClientOpsError(null);

    fetchClientOpsSnapshot(clientId)
      .then((snapshot) => {
        if (!cancelled) setClientOpsSnapshot(snapshot);
      })
      .catch((error: unknown) => {
        if (!cancelled) setClientOpsError(error instanceof Error ? error.message : 'No se pudo cargar el estado operativo real.');
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const opsAutomationsObserved = useMemo(
    () => (clientOpsSnapshot ? countObservedAutomations(clientOpsSnapshot.automations) : null),
    [clientOpsSnapshot],
  );

  const leadCounts = useMemo(
    () => ({
      total: leads.length,
      open: leads.filter((lead) => !CLOSED_LEAD_STAGES.has(lead.stage)).length,
    }),
    [leads],
  );

  // Derived from the SAME real fetch ClientMetaAdsPanel renders below —
  // never a second query, never the demo/localStorage MetaCampaign store.
  // countActiveMetaCampaigns is case-insensitive on `status` (Meta's real
  // API returns 'ACTIVE' uppercase) — see lib/api/meta-ads.ts.
  const metaAdsCounts = useMemo(() => countActiveMetaCampaigns(metaAdsData?.campaigns ?? []), [metaAdsData]);

  const automationsSummary = useMemo(() => summarizeAutomations(automations), [automations]);
  const agentsSummary = useMemo(() => summarizeAiAgents(agents), [agents]);
  // Content Truth V1: the Overview tile is operational truth, not a demo
  // preview — demo/seed content items must never make a real client look
  // like it has active production work. Manual-only, unlike the Content tab
  // itself (ClientContentPanel), which offers its own "Mostrar demo" toggle
  // over the full contentItems set passed below.
  const manualContentItems = useMemo(
    () => contentItems.filter((item) => item.dataSource === 'manual'),
    [contentItems],
  );
  const contentSummary = useMemo(() => summarizeContentItems(manualContentItems), [manualContentItems]);

  const relevantConnectionsForOnboarding = useMemo(
    () => allConnections.filter((c) => c.clientId === clientId || c.scope === 'internal'),
    [allConnections, clientId],
  );
  const onboardingSummary = useMemo(
    () => summarizeClientOnboarding(clientId, requirements, relevantConnectionsForOnboarding),
    [clientId, requirements, relevantConnectionsForOnboarding],
  );

  const attributedRevenueAllTime = useMemo(() => sumAttributedRevenue(revenueRecords), [revenueRecords]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="mb-4">
          <Link href="/clients" className="text-os-dim">← Volver a clientes</Link>
        </div>
        <div className="text-os-dim">Cargando cliente…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4">
        <div className="mb-4">
          <Link href="/clients" className="text-os-dim">← Volver a clientes</Link>
        </div>
        <div className="border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[11px] text-os-err">{loadError}</div>
      </div>
    );
  }

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

  async function handleEditClient(data: NewClientInput) {
    try {
      const updated = await updateClient(clientId, data);
      if (updated) {
        setClient(updated);
        setShowEditForm(false);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo actualizar el cliente.');
    }
  }

  async function handleConfirmDelete() {
    try {
      const result = await deleteClient(clientId);
      if (result.outcome === 'deleted') {
        router.push('/clients');
        return;
      }
      if (result.outcome === 'blocked') {
        setShowDeleteConfirm(false);
        setActionError(`No se puede eliminar: el cliente tiene ${result.leadCount} lead(s) registrados en el CRM.`);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'No se pudo eliminar el cliente.');
    }
  }

  function handleSaveNotes() {
    updateClientNotes(clientId, notes);
    setNotesDirty(false);
  }

  const hasRelatedRecords =
    leads.length > 0 ||
    metaAdsCounts.total > 0 ||
    automations.length > 0 ||
    agents.length > 0 ||
    requirements.length > 0 ||
    revenueRecords.length > 0 ||
    contentItems.length > 0 ||
    knowledgeEntries.length > 0;

  return (
    <div className="p-4">
      {actionError && (
        <div className="mb-4 border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[11px] text-os-err">{actionError}</div>
      )}
      {/* Header — client identity always visible regardless of active tab */}
      <div className="mb-6 border-b border-os-border pb-4">
        <div className="mb-4 flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
          <div className="min-w-0 max-w-full">
            <Link href="/clients" className="text-os-dim text-sm mb-2 block">← Volver a clientes</Link>
            <h1 className="break-words text-2xl font-semibold">{client.name}</h1>
            <div className="break-words text-sm text-os-dim">{client.sector} · {client.service}</div>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2 sm:shrink-0">
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0 p-2 border border-os-border bg-os-surface2 text-sm">
            <div className="text-[11px] text-os-dim uppercase tracking-wide">Estado</div>
            <div className="mt-1 break-words font-mono">{getClientStatusLabel(client.status)}</div>
          </div>
          <div className="min-w-0 p-2 border border-os-border bg-os-surface2 text-sm">
            <div className="text-[11px] text-os-dim uppercase tracking-wide">Presupuesto Meta</div>
            <div className="mt-1 break-words font-mono">{formatHeaderBudget(client.metaBudgetMonthly)}</div>
          </div>
          <div className="min-w-0 p-2 border border-os-border bg-os-surface2 text-sm">
            <div className="text-[11px] text-os-dim uppercase tracking-wide">Fecha de inicio</div>
            <div className="mt-1 break-words">{formatHeaderStartDate(client.startDate)}</div>
          </div>
          <div className="min-w-0 p-2 border border-os-border bg-os-surface2 text-sm">
            <div className="text-[11px] text-os-dim uppercase tracking-wide">Responsable</div>
            <div className="mt-1 break-words">{client.owner}</div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <nav className="mb-6 border-b border-os-border pb-3 sm:pb-0">
        <label className="block sm:hidden">
          <span className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.18em] text-os-dim">Sección</span>
          <select
            aria-label="Sección del cliente"
            value={activeTab}
            onChange={(event) => setActiveTab(event.target.value as TabKey)}
            className="w-full min-w-0 border border-os-border bg-os-surface px-3 py-2 text-sm text-os-text outline-none focus:border-os-border-strong"
          >
            {(Object.keys(TAB_LABELS) as TabKey[]).map((tab) => (
              <option key={tab} value={tab}>{TAB_LABELS[tab]}</option>
            ))}
          </select>
        </label>
        <div className="hidden sm:block">
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-mono text-os-dim">
          {(['overview', 'meta-ads', 'leads', 'automations', 'agents', 'integrations', 'content', 'knowledge', 'results', 'notes'] as TabKey[]).map((tab) => (
            <li
              key={tab}
              className={`min-w-0 cursor-pointer break-words pb-2 transition-colors ${
                activeTab === tab ? 'text-os-accent border-b border-os-accent -mb-[1px]' : 'hover:text-os-muted'
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {TAB_LABELS[tab]}
            </li>
          ))}
        </ul>
        </div>
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
            opsAutomationsObserved={opsAutomationsObserved}
            opsAutomationsTotal={clientOpsSnapshot?.automations.length ?? 5}
            opsAgentStatus={clientOpsSnapshot?.agent.status ?? null}
            onboardingSummary={onboardingSummary}
            contentSummary={contentSummary}
            attributedRevenueAllTime={attributedRevenueAllTime}
            onOpenTab={(tab) => setActiveTab(tab)}
          />
        )}

        {activeTab === 'meta-ads' && <ClientMetaAdsPanel data={metaAdsData} error={metaAdsError} />}

        {activeTab === 'leads' && <ClientLeadsPanel leads={leads} />}

        {activeTab === 'automations' && (
          <ClientAutomationsPanel
            automations={automations}
            opsAutomations={clientOpsSnapshot?.automations ?? null}
            opsError={clientOpsError}
          />
        )}

        {activeTab === 'agents' && (
          <ClientAgentsPanel agents={agents} opsAgent={clientOpsSnapshot?.agent ?? null} opsError={clientOpsError} />
        )}

        {activeTab === 'integrations' && (
          <ClientIntegrationsPanel
            clientId={clientId}
            requirements={requirements}
            allConnections={allConnections}
            loading={connectionsLoading}
            error={connectionsError}
          />
        )}

        {activeTab === 'content' && (
          <ClientContentPanel
            clientId={clientId}
            items={contentItems}
            onContentChanged={() => setContentItems(getContentItems(clientId))}
          />
        )}

        {activeTab === 'knowledge' && (
          <ClientKnowledgePanel
            clientId={clientId}
            entries={knowledgeEntries}
            onKnowledgeChanged={() => {
              getKnowledgeEntries(clientId)
                .then(setKnowledgeEntries)
                .catch((error: unknown) => console.error('Failed to reload knowledge entries', error));
            }}
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
          <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto break-words bg-os-surface border border-os-border p-4">
            <h3 className="mb-3 text-lg font-semibold">Eliminar cliente</h3>
            <p className="text-sm text-os-dim mb-4">
              ¿Seguro que quieres eliminar a <strong>{client.name}</strong>? Esta acción no se puede deshacer.
            </p>
            {leads.length > 0 && (
              <p className="text-sm text-os-warn mb-4 border border-os-border bg-os-surface2 px-3 py-2">
                Este cliente tiene {leads.length} lead(s) en el CRM. No se puede eliminar mientras tenga leads asociados.
              </p>
            )}
            {leads.length === 0 && hasRelatedRecords && (
              <p className="text-sm text-os-warn mb-4 border border-os-border bg-os-surface2 px-3 py-2">
                Este cliente tiene campañas, automatizaciones, agentes, integraciones, ingresos o conocimiento registrados.
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

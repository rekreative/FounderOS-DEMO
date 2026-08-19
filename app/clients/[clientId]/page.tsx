'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getClientById, initializeStoreIfNeeded, Client, updateClient, deleteClient, getClientNotes, updateClientNotes, getClientStatusLabel } from '@/lib/clients';
import { ClientsForm, type NewClientInput } from '@/components/ClientsForm';
import Link from 'next/link';

type TabKey = 'overview' | 'meta-ads' | 'leads' | 'automations' | 'content' | 'results' | 'notes';

const TAB_LABELS: Record<TabKey, string> = {
  overview: 'Resumen',
  'meta-ads': 'Meta Ads',
  leads: 'Leads',
  automations: 'Automatizaciones',
  content: 'Contenido',
  results: 'Resultados',
  notes: 'Notas',
};

export default function ClientDetailPage({ params }: { params: { clientId: string } }) {
  const clientId = params?.clientId ?? '';
  const [client, setClient] = useState<Client | null>(null);
  const [notes, setNotes] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const router = useRouter();

  useEffect(() => {
    initializeStoreIfNeeded();
    const c = getClientById(clientId);
    setClient(c);
    if (c) {
      setNotes(getClientNotes(c.id));
    }
  }, [clientId]);

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

  return (
    <div className="p-4">
      {/* Header */}
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
          {(['overview', 'meta-ads', 'leads', 'automations', 'content', 'results', 'notes'] as TabKey[]).map((tab) => (
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
          <div>
            <h3 className="text-lg font-semibold mb-4">Resumen</h3>
            <div className="space-y-4">
              {/* Client info summary */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 border border-os-border bg-os-surface2">
                  <div className="text-[11px] text-os-dim uppercase tracking-wide">Nombre</div>
                  <div className="mt-2 font-semibold">{client.name}</div>
                </div>
                <div className="p-3 border border-os-border bg-os-surface2">
                  <div className="text-[11px] text-os-dim uppercase tracking-wide">Estado</div>
                  <div className="mt-2 font-mono">{getClientStatusLabel(client.status)}</div>
                </div>
                <div className="p-3 border border-os-border bg-os-surface2">
                  <div className="text-[11px] text-os-dim uppercase tracking-wide">Sector</div>
                  <div className="mt-2">{client.sector}</div>
                </div>
                <div className="p-3 border border-os-border bg-os-surface2">
                  <div className="text-[11px] text-os-dim uppercase tracking-wide">Servicio</div>
                  <div className="mt-2">{client.service}</div>
                </div>
              </div>

              {/* KPI placeholder section */}
              <div className="mt-6">
                <h4 className="text-sm font-semibold text-os-dim mb-3 uppercase tracking-wide">Métricas de rendimiento</h4>
                <div className="grid grid-cols-4 gap-3">
                  <div className="p-3 border border-os-border bg-os-surface2">
                    <div className="text-[11px] text-os-dim uppercase tracking-wide">Leads</div>
                    <div className="mt-2 text-lg text-os-muted font-mono">—</div>
                    <div className="text-[10px] text-os-dim mt-1">Próximamente desde el módulo de Leads</div>
                  </div>
                  <div className="p-3 border border-os-border bg-os-surface2">
                    <div className="text-[11px] text-os-dim uppercase tracking-wide">CPL</div>
                    <div className="mt-2 text-lg text-os-muted font-mono">—</div>
                    <div className="text-[10px] text-os-dim mt-1">Próximamente desde el módulo de Resultados</div>
                  </div>
                  <div className="p-3 border border-os-border bg-os-surface2">
                    <div className="text-[11px] text-os-dim uppercase tracking-wide">Gasto en anuncios</div>
                    <div className="mt-2 text-lg text-os-muted font-mono">—</div>
                    <div className="text-[10px] text-os-dim mt-1">Próximamente desde el módulo de Meta Ads</div>
                  </div>
                  <div className="p-3 border border-os-border bg-os-surface2">
                    <div className="text-[11px] text-os-dim uppercase tracking-wide">Conversiones</div>
                    <div className="mt-2 text-lg text-os-muted font-mono">—</div>
                    <div className="text-[10px] text-os-dim mt-1">Próximamente desde el módulo de Resultados</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'meta-ads' && (
          <div className="p-4 border border-os-border bg-os-surface2 text-os-dim">
            <h3 className="font-semibold mb-2">Módulo Meta Ads</h3>
            <p className="text-sm">Este módulo se conectará en una futura iteración. Aquí aparecerán los datos de rendimiento de anuncios de Meta en tiempo real.</p>
          </div>
        )}

        {activeTab === 'leads' && (
          <div className="p-4 border border-os-border bg-os-surface2 text-os-dim">
            <h3 className="font-semibold mb-2">Módulo Leads</h3>
            <p className="text-sm">Este módulo se conectará en una futura iteración. Aquí aparecerán el seguimiento de leads y los datos del pipeline.</p>
          </div>
        )}

        {activeTab === 'automations' && (
          <div className="p-4 border border-os-border bg-os-surface2 text-os-dim">
            <h3 className="font-semibold mb-2">Módulo Automatizaciones</h3>
            <p className="text-sm">Este módulo se conectará en una futura iteración. Aquí aparecerán las automatizaciones de flujos y sus disparadores.</p>
          </div>
        )}

        {activeTab === 'content' && (
          <div className="p-4 border border-os-border bg-os-surface2 text-os-dim">
            <h3 className="font-semibold mb-2">Módulo Contenido</h3>
            <p className="text-sm">Este módulo se conectará en una futura iteración. Aquí aparecerán la biblioteca de contenido y la gestión de recursos.</p>
          </div>
        )}

        {activeTab === 'results' && (
          <div className="flex flex-col items-start gap-3 border border-os-border bg-os-surface2 p-4">
            <div>
              <h3 className="mb-1 font-semibold text-os-text">Resultados</h3>
              <p className="text-sm text-os-dim">
                Gasto publicitario, funnel comercial, ingresos atribuidos, ROAS y CAC de {client.name} viven en su propio dashboard dedicado.
              </p>
            </div>
            <Link
              href={`/clients/${client.id}/results`}
              className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
            >
              Abrir dashboard de resultados →
            </Link>
          </div>
        )}

        {activeTab === 'notes' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Notas</h3>
            <div className="space-y-2">
              <textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setNotesDirty(true);
                }}
                placeholder="Añade notas sobre este cliente..."
                className="w-full h-40 p-3 border border-os-border bg-transparent text-white font-mono text-sm resize-none"
              />
              <div className="flex justify-end">
                <button
                  onClick={handleSaveNotes}
                  disabled={!notesDirty}
                  className={`px-3 py-1 ${
                    notesDirty
                      ? 'bg-os-accent text-black cursor-pointer'
                      : 'bg-os-surface2 text-os-dim border border-os-border cursor-not-allowed'
                  }`}
                >
                  {notesDirty ? 'Guardar' : 'Guardado'}
                </button>
              </div>
            </div>
          </div>
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

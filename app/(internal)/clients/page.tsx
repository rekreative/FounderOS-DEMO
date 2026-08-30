'use client';

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ClientsList } from '@/components/ClientsList';
import { ClientsForm, NewClientInput } from '@/components/ClientsForm';
import { useClientsRegistry } from '@/components/ClientsProvider';
import { createClient } from '@/lib/api/clients';
import { ClientStatus, CLIENT_STATUS_OPTIONS } from '@/lib/clients';
import { PageHeader } from '@/components/PageHeader';

// UI-only filter state — never persisted, matches the same filter-bar
// pattern already used on /leads and /meta-ads (STATUS_FILTERS + a client
// select), just against Clientes' own status vocabulary.
const STATUS_FILTERS = [{ id: 'all' as const, label: 'Todos' }, ...CLIENT_STATUS_OPTIONS];

export default function ClientsPage() {
  // Canonical PostgreSQL Client registry — the same source every other
  // module reads, so /clients is never a second visible truth.
  const { clients, loading, error, refresh } = useClientsRegistry();
  const [showNew, setShowNew] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ClientStatus>('all');
  const [createError, setCreateError] = useState<string | null>(null);

  const filteredClients = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.sector.toLowerCase().includes(q) ||
        c.owner.toLowerCase().includes(q)
      );
    });
  }, [clients, query, statusFilter]);

  async function handleCreate(data: NewClientInput) {
    setCreateError(null);
    try {
      await createClient({ ...data });
      setShowNew(false);
      refresh(); // re-fetch the canonical registry so every module sees it
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'No se pudo crear el cliente.');
    }
  }

  return (
    <div className="p-4">
      <PageHeader
        eyebrow="REKREATIVE CLIENTES"
        title="Clientes"
        right={
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-os-text hover:border-os-border-strong hover:text-os-accent"
          >
            Nuevo cliente
          </button>
        }
      />

      <p className="text-os-dim text-sm mb-2">{loading ? 'Cargando clientes…' : `${clients.length} clientes`}</p>

      {error && (
        <div className="mb-4 border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">{error}</div>
      )}
      {createError && (
        <div className="mb-4 border border-os-err bg-os-err/10 px-3 py-2 font-mono text-[10.5px] text-os-err">{createError}</div>
      )}

      <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full min-w-0 sm:w-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-os-dim" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar cliente..."
            className="w-full min-w-0 border border-os-border bg-os-surface py-1.5 pl-8 pr-2.5 text-[12.5px] text-os-text outline-none placeholder:text-os-dim focus:border-os-border-strong sm:w-auto"
          />
        </div>

        <div className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          {STATUS_FILTERS.map((option) => {
            const active = statusFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatusFilter(option.id)}
                className={`min-w-0 break-words border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${
                  active ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent' : 'border-os-border text-os-dim hover:border-os-border-strong hover:text-os-muted'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-2">
        {loading ? (
          <div className="rounded-lg-t border border-dashed border-os-border bg-os-surface2 px-4 py-6 text-center font-mono text-[11px] text-os-dim">
            Cargando clientes…
          </div>
        ) : (
          <ClientsList clients={filteredClients} />
        )}
      </section>

      {showNew && <ClientsForm mode="create" onCancel={() => setShowNew(false)} onCreate={handleCreate} />}
    </div>
  );
}

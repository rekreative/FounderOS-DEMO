'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ClientsList } from '@/components/ClientsList';
import { ClientsForm, NewClientInput } from '@/components/ClientsForm';
import { initializeStoreIfNeeded, getClients, createClient, Client, ClientStatus, CLIENT_STATUS_OPTIONS } from '@/lib/clients';
import { PageHeader } from '@/components/PageHeader';

// UI-only filter state — never persisted, matches the same filter-bar
// pattern already used on /leads and /meta-ads (STATUS_FILTERS + a client
// select), just against Clientes' own status vocabulary.
const STATUS_FILTERS = [{ id: 'all' as const, label: 'Todos' }, ...CLIENT_STATUS_OPTIONS];

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ClientStatus>('all');

  useEffect(() => {
    // Ensure seed is present on first load
    initializeStoreIfNeeded();
    setClients(getClients());
  }, []);

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

  function handleCreate(data: NewClientInput) {
    const created = createClient({ ...data });
    setClients((s) => [created, ...s]);
    setShowNew(false);
    // push state is unnecessary; list updated in memory
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

      <p className="text-os-dim text-sm mb-2">{clients.length} clientes</p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-os-dim" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar cliente..."
            className="border border-os-border bg-os-surface py-1.5 pl-8 pr-2.5 text-[12.5px] text-os-text outline-none placeholder:text-os-dim focus:border-os-border-strong"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((option) => {
            const active = statusFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setStatusFilter(option.id)}
                className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${
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
        <ClientsList clients={filteredClients} />
      </section>

      {showNew && <ClientsForm mode="create" onCancel={() => setShowNew(false)} onCreate={handleCreate} />}
    </div>
  );
}

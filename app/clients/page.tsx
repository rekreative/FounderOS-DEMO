'use client';

import React, { useEffect, useState } from 'react';
import { ClientsList } from '@/components/ClientsList';
import { ClientsForm, NewClientInput } from '@/components/ClientsForm';
import { initializeStoreIfNeeded, getClients, createClient, Client } from '@/lib/clients';
import { SectionHead } from '@/components/terminal';

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    // Ensure seed is present on first load
    initializeStoreIfNeeded();
    setClients(getClients());
  }, []);

  function handleCreate(data: NewClientInput) {
    const created = createClient({ ...data });
    setClients((s) => [created, ...s]);
    setShowNew(false);
    // push state is unnecessary; list updated in memory
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <SectionHead label="Clientes" count={clients.length} />
        <div className="shrink-0">
          <button className="px-3 py-1 border border-os-border" onClick={() => setShowNew(true)}>
            Nuevo cliente
          </button>
        </div>
      </div>

      <p className="text-os-dim text-sm mb-2">{clients.length} clientes</p>

      <section className="mt-2">
        <ClientsList clients={clients} />
      </section>

      {showNew && <ClientsForm mode="create" onCancel={() => setShowNew(false)} onCreate={handleCreate} />}
    </div>
  );
}

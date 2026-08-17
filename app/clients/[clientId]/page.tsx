'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getClientById, initializeStoreIfNeeded, Client } from '@/lib/clients';
import Link from 'next/link';

export default function ClientDetailPage({ params }: { params: { clientId: string } }) {
  const clientId = params?.clientId ?? '';
  const [client, setClient] = useState<Client | null>(null);
  const router = useRouter();

  useEffect(() => {
    initializeStoreIfNeeded();
    const c = getClientById(clientId);
    setClient(c);
  }, [clientId]);

  if (!client) {
    return (
      <div className="p-4">
        <div className="mb-4">
          <Link href="/clients" className="text-os-dim">← Back to clients</Link>
        </div>
        <div className="text-os-dim">Client not found.</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          <div className="text-os-dim text-sm">{client.sector} · {client.service}</div>
        </div>
        <div className="font-mono text-sm text-os-dim">{client.status}</div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-3 border border-os-border bg-os-surface2">
          <div className="text-xs text-os-dim">Meta Budget (monthly)</div>
          <div className="font-mono mt-1">${Math.round(client.metaBudgetMonthly).toLocaleString()}</div>
        </div>
        <div className="p-3 border border-os-border bg-os-surface2">
          <div className="text-xs text-os-dim">Start Date</div>
          <div className="mt-1">{client.startDate}</div>
        </div>
        <div className="p-3 border border-os-border bg-os-surface2">
          <div className="text-xs text-os-dim">Owner</div>
          <div className="mt-1">{client.owner}</div>
        </div>
      </div>

      <nav className="mb-4 border-b border-os-border">
        <ul className="flex gap-4 text-sm font-mono text-os-dim">
          <li className="pb-2 text-os-accent">Overview</li>
          <li className="pb-2">Meta Ads</li>
          <li className="pb-2">Leads</li>
          <li className="pb-2">Automations</li>
          <li className="pb-2">Content</li>
          <li className="pb-2">Results</li>
          <li className="pb-2">Notes</li>
        </ul>
      </nav>

      <section>
        <h3 className="text-lg font-semibold mb-2">Overview</h3>
        <div className="p-4 border border-os-border bg-os-surface2">Basic overview content for {client.name} — placeholder for Client Workspace.</div>
      </section>

      <section className="mt-6">
        <h4 className="text-sm font-semibold mb-2">Other areas</h4>
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 border border-os-border bg-os-surface2 text-os-dim">Meta Ads: No data connected yet</div>
          <div className="p-3 border border-os-border bg-os-surface2 text-os-dim">Leads: No data connected yet</div>
          <div className="p-3 border border-os-border bg-os-surface2 text-os-dim">Automations: No data connected yet</div>
          <div className="p-3 border border-os-border bg-os-surface2 text-os-dim">Content: No data connected yet</div>
          <div className="p-3 border border-os-border bg-os-surface2 text-os-dim">Results: No data connected yet</div>
          <div className="p-3 border border-os-border bg-os-surface2 text-os-dim">Notes: No data connected yet</div>
        </div>
      </section>
    </div>
  );
}

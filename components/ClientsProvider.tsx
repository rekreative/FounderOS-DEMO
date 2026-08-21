'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Client } from '@/lib/clients';
import { getClients } from '@/lib/api/clients';

/**
 * The single canonical Client registry for the whole OS — one PostgreSQL-
 * backed fetch, mounted once in app/layout.tsx, read everywhere a module
 * needs to resolve/select/display a real client. This is the mechanism that
 * keeps "REKREATIVE is never a Client" and "no two visible client
 * registries" true at the same time: /clients, /leads, Client Workspace,
 * Home, Analytics/Results, and every still-localStorage module's client
 * selector (Automations, Agents IA, Integrations, Meta Ads, Knowledge) all
 * read from this one Context instead of each re-fetching or falling back to
 * the legacy localStorage seed.
 *
 * A plain Context is enough here — one read-mostly list, refreshed after
 * the few places that mutate it (create/update/delete on /clients and
 * Client Workspace). No Redux/Zustand needed for a single shared list.
 */

type ClientsRegistry = {
  clients: Client[];
  loading: boolean;
  error: string | null;
  /** Re-fetches the canonical list — call after create/update/delete. */
  refresh: () => void;
};

const ClientsRegistryContext = createContext<ClientsRegistry | null>(null);

export function ClientsProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getClients()
      .then((result) => {
        if (cancelled) return;
        setClients(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load clients');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return (
    <ClientsRegistryContext.Provider value={{ clients, loading, error, refresh }}>
      {children}
    </ClientsRegistryContext.Provider>
  );
}

export function useClientsRegistry(): ClientsRegistry {
  const ctx = useContext(ClientsRegistryContext);
  if (!ctx) throw new Error('useClientsRegistry must be used within a ClientsProvider');
  return ctx;
}

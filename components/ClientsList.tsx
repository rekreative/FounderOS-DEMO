'use client';

import React from 'react';
import Link from 'next/link';
import { getClientStatusLabel, type Client } from '@/lib/clients';

// Explicit useGrouping avoids a runtime quirk where bare
// .toLocaleString('es-ES') silently drops the thousands separator.
function formatBudget(value: number): string {
  return `${Math.round(value).toLocaleString('es-ES', { useGrouping: true })} €`;
}

// startDate is stored date-only ('YYYY-MM-DD'); display only, never the
// stored value itself. UTC keeps the displayed day from shifting with the
// viewer's local timezone.
function formatStartDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

export function ClientsList({ clients }: { clients: Client[] }) {
  return (
    <>
      <div className="grid gap-2 md:hidden">
        {clients.length === 0 ? (
          <div className="border border-dashed border-os-border px-3 py-6 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
            No hay clientes que coincidan con estos filtros.
          </div>
        ) : clients.map((client) => (
          <Link key={client.id} href={`/clients/${client.id}`} className="min-w-0 border border-os-border bg-os-surface p-4 transition-colors hover:bg-os-surface2">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="break-words text-[13px] font-semibold text-os-text">{client.name}</div>
                <div className="mt-1 break-words text-[11px] text-os-dim">{client.sector} · {client.service}</div>
              </div>
              <span className={`shrink-0 border border-os-border bg-os-surface2 px-2 py-0.5 font-mono text-[10px] tracking-wide ${
                client.status === 'active' ? 'text-os-ok' : client.status === 'paused' ? 'text-os-dim' : 'text-os-accent'
              }`}>
                {getClientStatusLabel(client.status)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-os-border pt-3">
              <div className="min-w-0">
                <div className="font-mono text-[8px] uppercase tracking-wide text-os-dim">Presupuesto Meta</div>
                <div className="mt-1 break-words font-mono text-[11px] text-os-muted">{formatBudget(client.metaBudgetMonthly)}</div>
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[8px] uppercase tracking-wide text-os-dim">Responsable</div>
                <div className="mt-1 break-words text-[11px] text-os-muted">{client.owner}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-[12px] uppercase tracking-wide text-os-dim border-b border-os-border">
            <th className="px-3 py-2">Cliente</th>
            <th className="px-3 py-2">Sector</th>
            <th className="px-3 py-2">Estado</th>
            <th className="px-3 py-2">Servicio</th>
            <th className="px-3 py-2">Presupuesto Meta</th>
            <th className="px-3 py-2">Fecha de inicio</th>
            <th className="px-3 py-2">Responsable</th>
          </tr>
        </thead>
        <tbody>
          {clients.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center font-mono text-[10px] uppercase tracking-wide text-os-dim">
                No hay clientes que coincidan con estos filtros.
              </td>
            </tr>
          ) : (
            clients.map((c) => (
              <tr
                key={c.id}
                className="group border-t border-os-border hover:bg-os-surface2 transition-colors"
              >
                <td className="px-3 py-2">
                  <Link href={`/clients/${c.id}`} className="block truncate font-semibold text-[13px] hover:text-os-accent">
                    {c.name}
                  </Link>
                </td>
                <td className="max-w-[180px] break-words px-3 py-2 text-[13px] text-os-dim">{c.sector}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 text-[11px] font-mono tracking-wide rounded-sm ${
                    c.status === 'active' ? 'text-os-ok border border-os-border bg-os-surface2' : c.status === 'paused' ? 'text-os-dim border border-os-border bg-os-surface2' : 'text-os-accent border border-os-border bg-os-surface2'
                  }`}>
                    {getClientStatusLabel(c.status)}
                  </span>
                </td>
                <td className="max-w-[220px] break-words px-3 py-2 text-[13px] text-os-dim">{c.service}</td>
                <td className="px-3 py-2 text-[13px] font-mono">{formatBudget(c.metaBudgetMonthly)}</td>
                <td className="px-3 py-2 text-[13px] text-os-dim">{formatStartDate(c.startDate)}</td>
                <td className="max-w-[180px] break-words px-3 py-2 text-[13px] text-os-dim">{c.owner}</td>
              </tr>
            ))
          )}
        </tbody>
        </table>
      </div>
    </>
  );
}

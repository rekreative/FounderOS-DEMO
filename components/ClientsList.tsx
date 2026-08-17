'use client';

import React from 'react';
import Link from 'next/link';
import type { Client } from '@/lib/clients';

export function ClientsList({ clients }: { clients: Client[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="text-[12px] uppercase tracking-wide text-os-dim border-b border-os-border">
            <th className="px-3 py-2">Client</th>
            <th className="px-3 py-2">Sector</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Service</th>
            <th className="px-3 py-2">Meta Budget</th>
            <th className="px-3 py-2">Start Date</th>
            <th className="px-3 py-2">Owner</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr
              key={c.id}
              className="group border-t border-os-border hover:bg-os-surface2 transition-colors"
            >
              <td className="px-3 py-2">
                <Link href={`/clients/${c.id}`} className="block truncate font-semibold text-[13px] hover:text-os-accent">
                  {c.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-[13px] text-os-dim">{c.sector}</td>
              <td className="px-3 py-2">
                <span className={`inline-block px-2 py-0.5 text-[11px] font-mono tracking-wide rounded-sm ${
                  c.status === 'active' ? 'text-os-ok border border-os-border bg-os-surface2' : c.status === 'paused' ? 'text-os-dim border border-os-border bg-os-surface2' : 'text-os-accent border border-os-border bg-os-surface2'
                }`}>
                  {c.status}
                </span>
              </td>
              <td className="px-3 py-2 text-[13px] text-os-dim">{c.service}</td>
              <td className="px-3 py-2 text-[13px] font-mono">${Math.round(c.metaBudgetMonthly).toLocaleString()}</td>
              <td className="px-3 py-2 text-[13px] text-os-dim">{c.startDate}</td>
              <td className="px-3 py-2 text-[13px] text-os-dim">{c.owner}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

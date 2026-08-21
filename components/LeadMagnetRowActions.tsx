'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import type { LeadMagnet } from '@/lib/schemas';

/**
 * Per-row controls for the lead magnet register: retire a page or drop the row
 * without leaving the table. Append-only was half a tool.
 *
 * Delete asks once, inline, because these rows carry the live URL of a page
 * that may already be in a caption somewhere.
 */
const STATUSES: LeadMagnet['status'][] = ['live', 'draft', 'paused', 'archived'];

const STATUS_LABEL: Record<LeadMagnet['status'], string> = {
  live: 'Activo',
  draft: 'Borrador',
  paused: 'Pausado',
  archived: 'Archivado',
};

export function LeadMagnetRowActions({ id, status }: { id: string; status: LeadMagnet['status'] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const call = async (init: RequestInit) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/lead-magnets/${encodeURIComponent(id)}`, {
        headers: { 'Content-Type': 'application/json' },
        ...init,
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <span className="flex items-center gap-1.5">
      <select
        aria-label="Estado"
        disabled={busy}
        value={status}
        onChange={(e) => call({ method: 'PATCH', body: JSON.stringify({ status: e.target.value }) })}
        className="rounded-sm-t border border-os-border bg-os-bg px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-os-muted outline-none focus:border-os-border-strong disabled:opacity-40"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {confirming ? (
        <span className="flex items-center gap-1">
          <button
            onClick={() => call({ method: 'DELETE' })}
            disabled={busy}
            className="rounded-sm-t border border-os-border px-1.5 py-1 font-mono text-[10px] uppercase tracking-widest text-os-err transition-colors hover:border-os-border-strong disabled:opacity-40"
          >
            ¿seguro?
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="font-mono text-[10px] uppercase tracking-widest text-os-dim transition-colors hover:text-os-text"
          >
            no
          </button>
        </span>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          aria-label="Eliminar lead magnet"
          title="Eliminar"
          className="text-os-dim opacity-0 transition-opacity hover:text-os-err group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

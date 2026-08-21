'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';

/**
 * Create a lead magnet from inside the OS. Deploy the page wherever, then
 * register it here so the row lives with everything else. A content pipeline
 * can POST to the same route, so a page it ships lands in this table without
 * anyone typing.
 */
export function NewLeadMagnet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const empty = {
    name: '',
    url: '',
    offer: '',
    source: '',
    destination: 'Newsletter · lista principal',
    captures: 'email',
    status: 'live',
    launchedAt: today,
    notes: '',
  };
  const [form, setForm] = useState(empty);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/lead-magnets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        setError(typeof body.error === 'string' ? body.error : 'Revisa el nombre y la URL.');
        return;
      }
      const body = (await res.json()) as { leadMagnet?: { name?: string } };
      setDone(body.leadMagnet?.name ?? form.name);
      setForm(empty);
      setOpen(false);
      router.refresh(); // the table is a server component; pull the new row
    } catch {
      setError('Error de red. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-sm-t border border-os-border bg-os-bg px-2.5 py-2 text-[12px] text-os-text outline-none placeholder:text-os-dim focus:border-os-border-strong';
  const label = 'mb-1 block font-mono text-[9.5px] uppercase tracking-[0.16em] text-os-dim';

  if (!open) {
    return (
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => {
            setDone(null);
            setOpen(true);
          }}
          className="flex items-center gap-1.5 rounded-sm-t border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-widest text-os-accent transition-colors hover:border-os-border-strong"
        >
          <Plus className="h-3 w-3" /> Nuevo lead magnet
        </button>
        {done && (
          <span className="font-mono text-[10.5px] text-os-ok">
            Se añadió {done} al registro.
          </span>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-4 rounded-lg-t border border-os-border bg-os-surface p-4">
      <div className="mb-3 flex items-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-os-dim">Registrar una página</span>
        <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="ml-auto text-os-dim hover:text-os-text">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="lm-name">Nombre</label>
          <input id="lm-name" className={field} value={form.name} onChange={set('name')} required placeholder="Guía del embudo Meta Ads" />
        </div>
        <div>
          <label className={label} htmlFor="lm-url">URL en vivo</label>
          <input id="lm-url" className={field} value={form.url} onChange={set('url')} required type="url" placeholder="https://…" />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="lm-offer">Qué reciben</label>
          <input id="lm-offer" className={field} value={form.offer} onChange={set('offer')} placeholder="El proceso explicado paso a paso" />
        </div>
        <div>
          <label className={label} htmlFor="lm-source">Campaña para la que se creó</label>
          <input id="lm-source" className={field} value={form.source} onChange={set('source')} placeholder="Ej: comenta GUÍA" />
        </div>
        <div>
          <label className={label} htmlFor="lm-dest">Dónde llegan los leads</label>
          <input id="lm-dest" className={field} value={form.destination} onChange={set('destination')} />
        </div>
        <div>
          <label className={label} htmlFor="lm-captures">Captura</label>
          <select id="lm-captures" className={field} value={form.captures} onChange={set('captures')}>
            <option value="email">Email</option>
            <option value="booking">Reserva</option>
            <option value="none">Aún nada</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="lm-launched">Fecha de publicación</label>
          <input id="lm-launched" className={field} type="date" value={form.launchedAt} onChange={set('launchedAt')} />
        </div>
        <div>
          <label className={label} htmlFor="lm-status">Estado</label>
          <select id="lm-status" className={field} value={form.status} onChange={set('status')}>
            <option value="live">Activo</option>
            <option value="draft">Borrador</option>
            <option value="paused">Pausado</option>
            <option value="archived">Archivado</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="lm-notes">Notas</label>
          <textarea
            id="lm-notes"
            rows={2}
            className={`${field} resize-y`}
            value={form.notes}
            onChange={set('notes')}
            placeholder="Cualquier cosa que el futuro tú necesite saber: qué está gateado, qué falta por conectar, qué automatización lo alimenta"
          />
        </div>
      </div>
      {error && <p className="mt-2 font-mono text-[10.5px] text-os-err">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="mt-3 rounded-sm-t border border-os-border bg-os-surface2 px-3 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-widest text-os-accent transition-colors hover:border-os-border-strong disabled:opacity-40"
      >
        {busy ? 'guardando…' : 'añadir al registro'}
      </button>
    </form>
  );
}

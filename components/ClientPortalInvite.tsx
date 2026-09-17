'use client';

import { useState } from 'react';

export function ClientPortalInvite({ clientId }: { clientId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendInvite() {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError('Introduce el email del cliente.');
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/access/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'No se pudo enviar la invitación.');
      setNotice(`Invitación enviada a ${body.email}.`);
      setEmail('');
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'No se pudo enviar la invitación.');
    } finally {
      setPending(false);
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="border border-os-border px-3 py-1 text-sm text-os-muted hover:border-os-border-strong hover:text-os-text"
      >
        Dar acceso al portal
      </button>
    );
  }

  return (
    <div className="w-full border border-os-border bg-os-surface2 p-3 sm:w-auto sm:min-w-[320px]">
      <label className="block">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-os-dim">Email del cliente</span>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending}
          placeholder="cliente@email.com"
          className="mt-1 w-full border border-os-border bg-os-bg px-2.5 py-1.5 text-sm text-os-text outline-none focus:border-os-border-strong disabled:opacity-50"
        />
      </label>
      <p className="mt-2 text-[11px] text-os-dim">Recibirá un enlace para crear su contraseña y acceder solo a su cuenta.</p>
      {error && <p className="mt-2 font-mono text-[10px] text-os-err">{error}</p>}
      {notice && <p className="mt-2 font-mono text-[10px] text-os-ok">{notice}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={sendInvite}
          className="border border-os-border-strong bg-os-accent px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-os-ink disabled:opacity-50"
        >
          {pending ? 'Enviando…' : 'Enviar invitación'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setExpanded(false)}
          className="border border-os-border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-os-dim hover:text-os-text disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

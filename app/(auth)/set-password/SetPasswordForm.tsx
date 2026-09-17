'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/terminal';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function SetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 12) {
      setError('Usa una contraseña de al menos 12 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setError(null);
    setPending(true);
    const { error: updateError } = await getSupabaseBrowserClient().auth.updateUser({ password });
    if (updateError) {
      setError('No se pudo activar la cuenta. Abre de nuevo el enlace de invitación o contacta con REKREATIVE.');
      setPending(false);
      return;
    }

    router.replace('/portal');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-[400px] border border-os-border-strong bg-os-surface p-8">
      <Badge tone="accent">REKREATIVE</Badge>
      <h1 className="mt-3 font-mono text-[13px] font-bold uppercase tracking-[0.14em] text-os-text">Activa tu cuenta</h1>
      <p className="mt-2 text-sm text-os-dim">Crea una contraseña para entrar en tu espacio de trabajo.</p>

      <label className="mt-6 block">
        <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-os-muted">Contraseña</span>
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={pending}
          className="w-full border border-os-border bg-os-bg px-3 py-2 font-mono text-[13px] text-os-text outline-none focus:border-[var(--accent-line)] disabled:opacity-50"
        />
      </label>

      <label className="mt-4 block">
        <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-os-muted">Repite la contraseña</span>
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          disabled={pending}
          className="w-full border border-os-border bg-os-bg px-3 py-2 font-mono text-[13px] text-os-text outline-none focus:border-[var(--accent-line)] disabled:opacity-50"
        />
      </label>

      {error && <p className="mt-4 font-mono text-[11px] text-os-err">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full border border-os-border-strong bg-os-accent px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-os-ink disabled:opacity-50"
      >
        {pending ? 'Activando…' : 'Activar cuenta'}
      </button>
    </form>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Badge } from '@/components/terminal';

/**
 * signInWithPassword() is fully awaited before any navigation — the
 * @supabase/ssr browser client writes the session cookie synchronously as
 * part of resolving that call, so an awaited call has no race window with
 * the redirect. router.refresh() after router.push() is required, not
 * optional: Next's client-side navigation can otherwise reuse a cached
 * Server Component payload from before the cookie existed, even though the
 * cookie itself is already present in the browser.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      // Deliberately generic — never reveals whether the email exists.
      setError('Incorrect email or password.');
      setPending(false);
      return;
    }

    router.push('/me');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-[360px] border border-os-border-strong bg-os-surface p-8">
      <div className="mb-6">
        <Badge tone="accent">REKREATIVE OS</Badge>
        <h1 className="mt-3 font-mono text-[13px] font-bold uppercase tracking-[0.14em] text-os-text">Internal Login</h1>
      </div>

      <label className="mb-4 block">
        <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-os-muted">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          className="w-full border border-os-border bg-os-bg px-3 py-2 font-mono text-[13px] text-os-text outline-none focus:border-[var(--accent-line)] disabled:opacity-50"
        />
      </label>

      <label className="mb-6 block">
        <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-os-muted">Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          className="w-full border border-os-border bg-os-bg px-3 py-2 font-mono text-[13px] text-os-text outline-none focus:border-[var(--accent-line)] disabled:opacity-50"
        />
      </label>

      {error && <p className="mb-4 font-mono text-[11px] text-os-err">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full border border-os-border-strong bg-os-accent px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-os-ink disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

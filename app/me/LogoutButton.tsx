'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Client-side signOut(), acceptable for this milestone per the login-V1
 * design (fewest new moving parts; a POST Route Handler is the more robust
 * long-term choice once a real nav chrome exists to host a logout link —
 * revisit then, not now). Never claims success without awaiting the result.
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setPending(true);
    setError(null);

    const supabase = getSupabaseBrowserClient();
    const { error: signOutError } = await supabase.auth.signOut();
    setPending(false);

    if (signOutError) {
      setError('Logout failed — please try again.');
      return;
    }

    router.push('/login');
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleLogout}
        disabled={pending}
        className="border border-os-border-strong px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-os-text disabled:opacity-50"
      >
        {pending ? 'Signing out…' : 'Log out'}
      </button>
      {error && <p className="mt-2 font-mono text-[11px] text-os-err">{error}</p>}
    </div>
  );
}

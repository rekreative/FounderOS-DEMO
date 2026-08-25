'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * The one real logout control for internal REKREOS — lives in Topbar
 * (matching its existing 30x30 icon-button pattern) now that the temporary
 * /me diagnostic page (which hosted an earlier version of this logic) has
 * served its First Internal User + Login V1 QA purpose and is gone.
 * Client-side signOut(), same as before: awaited, error state doesn't claim
 * success, success path redirects to /login and forces a fresh
 * Server Component read (router.refresh()) so a stale RSC cache never shows
 * a page that thinks a session still exists.
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signOut();
    setPending(false);

    if (error) return; // stay put — never claim success on failure

    router.push('/login');
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      disabled={pending}
      title="Log out"
      aria-label="Log out"
      className="grid h-[30px] w-[30px] place-items-center rounded-sm-t border border-os-border bg-os-surface text-os-muted transition-colors hover:border-os-border-strong hover:text-os-err disabled:opacity-50"
    >
      <LogOut className="h-3.5 w-3.5" />
    </button>
  );
}

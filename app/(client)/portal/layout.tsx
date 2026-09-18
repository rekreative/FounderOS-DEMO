import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/server/auth';
import { AuthError } from '@/lib/server/auth-errors';
import { LogoutButton } from '@/components/LogoutButton';

/**
 * Client-only perimeter. The internal shell is intentionally never mounted
 * here, so a client cannot discover internal navigation, controls, or data
 * through the portal UI. Object-level API checks remain the enforcement for
 * every data request underneath this page boundary.
 */
export default async function ClientPortalLayout({ children }: { children: React.ReactNode }) {
  try {
    const user = await requireUser();
    if (user.role === 'internal') redirect('/');
  } catch (error) {
    if (error instanceof AuthError) redirect('/login');
    throw error;
  }

  return (
    <main className="min-h-screen bg-os-bg px-4 py-6 text-os-text sm:px-6 lg:px-8">
      <div className="mx-auto mb-6 flex max-w-6xl items-center justify-between border-b border-os-border pb-4">
        <div>
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-os-text">REKREOS</div>
          <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.16em] text-os-dim">Portal de cliente</div>
        </div>
        <LogoutButton />
      </div>
      {children}
    </main>
  );
}

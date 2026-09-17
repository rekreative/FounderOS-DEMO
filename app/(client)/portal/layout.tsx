import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/server/auth';
import { AuthError } from '@/lib/server/auth-errors';

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

  return <main className="min-h-screen bg-os-bg px-4 py-6 text-os-text sm:px-6 lg:px-8">{children}</main>;
}

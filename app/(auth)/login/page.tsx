import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireInternalUser } from '@/lib/server/auth';
import { AuthError } from '@/lib/server/auth-errors';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Login · REKREATIVE OS' };

/**
 * Internal login only, First Internal User + Login V1. No signup, no
 * client login, no OAuth, no magic link, no invite/reset flow — a single
 * email+password form, per this milestone's explicit scope.
 *
 * An already-authenticated internal user is redirected to / (avoids the
 * confusing "why am I seeing a login form" state). A non-internal — or
 * simply unauthenticated — visitor never gets redirected anywhere by this
 * check: any AuthError here just falls through to rendering the form. This
 * page must never grant internal access on its own; it only ever redirects
 * away from itself when requireInternalUser() has already independently
 * proven the visitor is a real internal user.
 */
export default async function LoginPage() {
  try {
    await requireInternalUser();
    redirect('/');
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    // Unauthenticated or authenticated-but-non-internal — show the form.
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <LoginForm />
    </div>
  );
}

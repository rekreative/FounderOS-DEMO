import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/server/auth';
import { AuthError } from '@/lib/server/auth-errors';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Login · REKREATIVE OS' };

/**
 * Shared human login. The authenticated user's server-side profile decides
 * the destination; client accounts never pass through the internal shell.
 */
export default async function LoginPage() {
  try {
    const user = await requireUser();
    redirect(user.role === 'internal' ? '/' : '/portal');
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

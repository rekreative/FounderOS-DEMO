import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Login · REKREATIVE OS' };

/**
 * Internal login only, First Internal User + Login V1. No signup, no
 * client login, no OAuth, no magic link, no invite/reset flow — a single
 * email+password form, per this milestone's explicit scope.
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <LoginForm />
    </div>
  );
}

import { requireInternalUser } from '@/lib/server/auth';
import { AuthError } from '@/lib/server/auth-errors';
import { LogoutButton } from './LogoutButton';

/**
 * TEMPORARY diagnostic page — First Internal User + Login V1 only. Exercises
 * the real chain server-side: requireInternalUser() → requireUser() →
 * getSupabaseUser() → Supabase auth.getUser() → profiles. Not a permanent
 * product surface: remove or replace once the next milestone protects real
 * internal routes and gives login a real landing page to redirect to
 * instead of this one.
 *
 * Renders only email + role — never a token, cookie, raw Supabase User
 * object, or access-grant detail.
 */
export default async function MePage() {
  try {
    const user = await requireInternalUser();
    return (
      <div className="max-w-[420px] border border-os-border-strong bg-os-surface p-8">
        <h1 className="mb-4 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-os-muted">Session</h1>
        <dl className="space-y-2 font-mono text-[13px] text-os-text">
          <div>
            <dt className="text-os-dim">Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div>
            <dt className="text-os-dim">Role</dt>
            <dd>{user.role}</dd>
          </div>
        </dl>
        <div className="mt-6">
          <LogoutButton />
        </div>
      </div>
    );
  } catch (error) {
    if (error instanceof AuthError) {
      return (
        <div className="max-w-[420px] border border-os-border-strong bg-os-surface p-8">
          <p className="font-mono text-[13px] text-os-err">Not signed in ({error.code}).</p>
        </div>
      );
    }
    throw error;
  }
}

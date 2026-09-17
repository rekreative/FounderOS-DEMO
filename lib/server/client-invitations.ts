import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getClientById } from './clients-repo';
import { ClientAccessProvisionError, provisionClientAccess } from './profiles-repo';

export class ClientInvitationError extends Error {
  constructor(
    message: string,
    readonly code: 'CLIENT_NOT_FOUND' | 'INVITE_FAILED' | 'PROVISION_FAILED' | 'PORTAL_URL_MISSING',
  ) {
    super(message);
  }
}

function clientPortalUrl(): string {
  const raw = process.env.REKREOS_APP_URL;
  if (!raw) throw new ClientInvitationError('REKREOS_APP_URL is not configured', 'PORTAL_URL_MISSING');

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('unsafe protocol');
    return new URL('/set-password', url).toString();
  } catch {
    throw new ClientInvitationError('REKREOS_APP_URL is not a valid application URL', 'PORTAL_URL_MISSING');
  }
}

/**
 * Creates a Supabase invite and immediately binds the returned identity to
 * the intended tenant. On a database provisioning failure it attempts to
 * delete the newly-created Auth user, so an unusable invite is not left
 * behind. The caller never receives raw provider errors or user metadata.
 */
export async function inviteClientAccount(input: { clientId: string; email: string }): Promise<{ email: string }> {
  const client = await getClientById(input.clientId);
  if (!client) throw new ClientInvitationError('client not found', 'CLIENT_NOT_FOUND');

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: clientPortalUrl(),
    data: { client_name: client.name },
  });
  if (error || !data.user) throw new ClientInvitationError('could not send the invitation', 'INVITE_FAILED');

  try {
    await provisionClientAccess(data.user.id, client.id);
  } catch (error) {
    // Best-effort compensation. If this itself fails, the account still has
    // no profile/grant, so it fails closed at login rather than seeing data.
    await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    if (error instanceof ClientAccessProvisionError) {
      throw new ClientInvitationError(error.message, 'PROVISION_FAILED');
    }
    throw error;
  }

  return { email: input.email };
}

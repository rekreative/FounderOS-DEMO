import { NextResponse } from 'next/server';
import { inviteClientAccount, ClientInvitationError } from '@/lib/server/client-invitations';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { InviteClientAccountBodySchema } from '@/lib/server/schemas';

export const dynamic = 'force-dynamic';

/** Internal operator only. This route is the sole invitation surface; it
 * derives tenant ownership from params.id and never accepts a redirect URL. */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = InviteClientAccountBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const result = await inviteClientAccount({ clientId: params.id, email: parsed.data.email });
    return NextResponse.json({ ok: true, email: result.email }, { status: 201 });
  } catch (error) {
    if (error instanceof ClientInvitationError) {
      const status = error.code === 'CLIENT_NOT_FOUND' ? 404 : error.code === 'PORTAL_URL_MISSING' ? 503 : 422;
      return jsonError(status, error.message, { code: error.code });
    }
    return unexpectedError('POST /api/clients/[id]/access/invite', error);
  }
}

import { NextResponse } from 'next/server';
import { updateClientMetaAccount } from '@/lib/server/meta-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { UpdateClientMetaAccountBodySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

function isOwnershipOverlap(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23P01';
}

/** clientId and metaAdAccountId are immutable — see UpdateClientMetaAccountBodySchema's
 *  doc comment. To re-map a client to a different ad account: PATCH the old
 *  mapping to `active: false`, then POST a new one. */
export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = UpdateClientMetaAccountBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const account = await updateClientMetaAccount(params.id, parsed.data);
    if (!account) return jsonError(404, 'Meta account mapping not found');
    return NextResponse.json({ account });
  } catch (error) {
    if (isOwnershipOverlap(error)) return jsonError(422, 'this Meta ad account already has an overlapping ownership mapping');
    return unexpectedError('PATCH /api/meta-ads/accounts/[id]', error);
  }
}

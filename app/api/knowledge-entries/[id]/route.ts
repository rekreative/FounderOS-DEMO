import { NextResponse } from 'next/server';
import { KnowledgeEntryValidationError, updateKnowledgeEntry } from '@/lib/server/knowledge-entries-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { UpdateKnowledgeEntryBodySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/knowledge-entries/[id]
 *
 * Internal-only, same as POST/GET (see route.ts's doc comment). Covers
 * edit AND archive/restore — both are just a status field patch, same
 * contract lib/knowledge-entries.ts's old archiveKnowledgeEntry/
 * restoreKnowledgeEntry had over updateKnowledgeEntry. No DELETE endpoint:
 * G-Brain has no hard-delete in V1, only the active/archived status.
 * updatedBy is set from the authenticated user's id, never accepted from
 * the request body.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = UpdateKnowledgeEntryBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const entry = await updateKnowledgeEntry(params.id, { ...parsed.data, updatedBy: auth.user.id });
    if (!entry) return jsonError(404, 'knowledge entry not found');
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof KnowledgeEntryValidationError) return jsonError(422, error.message, { code: error.code });
    return unexpectedError('PATCH /api/knowledge-entries/[id]', error);
  }
}

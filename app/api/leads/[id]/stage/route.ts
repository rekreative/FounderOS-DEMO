import { NextResponse } from 'next/server';
import { setLeadStage } from '@/lib/server/leads-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { StageChangeBodySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/** POST { "stage": "qualified" } — the only path that changes a lead's
 *  stage, because it's the only path that atomically appends the matching
 *  stage_changed event too (see lib/server/leads-repo.ts's setLeadStage). */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = StageChangeBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const result = await setLeadStage(params.id, parsed.data.stage, 'manual');
    if (!result) return jsonError(404, 'lead not found');
    return NextResponse.json({ lead: result.lead, event: result.event });
  } catch (error) {
    return unexpectedError('POST /api/leads/[id]/stage', error);
  }
}

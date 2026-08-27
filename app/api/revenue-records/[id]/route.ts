import { NextResponse } from 'next/server';
import { RevenueRecordValidationError, updateRevenueRecord } from '@/lib/server/revenue-records-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { UpdateRevenueRecordBodySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/revenue-records/[id]
 *
 * Internal-only — matches PATCH /api/leads/[id]. No delete endpoint exists:
 * the current Results UX never offered one (Create + Update only), and this
 * migration preserves that exactly. updatedBy is set from the authenticated
 * user's id, never accepted from the request body.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = UpdateRevenueRecordBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const record = await updateRevenueRecord(params.id, { ...parsed.data, updatedBy: auth.user.id });
    if (!record) return jsonError(404, 'revenue record not found');
    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof RevenueRecordValidationError) return jsonError(422, error.message, { code: error.code });
    return unexpectedError('PATCH /api/revenue-records/[id]', error);
  }
}

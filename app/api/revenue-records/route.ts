import { NextResponse } from 'next/server';
import { createRevenueRecord, listRevenueRecords, RevenueRecordValidationError } from '@/lib/server/revenue-records-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { CreateRevenueRecordBodySchema, ListRevenueRecordsQuerySchema } from '@/lib/server/schemas';
import { requireClientAccessOrResponse, requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/revenue-records?clientId=client-acme
 *
 * Results Manual Revenue V1 — the manual revenue ledger's new PostgreSQL
 * home, replacing lib/results.ts's browser-localStorage RevenueRecord store.
 * A separate, secondary ledger — never merged into "Valor generado" or the
 * real ROAS/CAC calculations (GET /api/results). clientId is required (no
 * global view exists); tenant-aware: internal may pass any clientId, a
 * client-role caller must hold a grant for it.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = ListRevenueRecordsQuerySchema.safeParse({
    clientId: url.searchParams.get('clientId') ?? undefined,
  });
  if (!parsed.success) return jsonError(400, 'invalid query parameters', { issues: parsed.error.flatten() });

  const auth = await requireClientAccessOrResponse(parsed.data.clientId);
  if ('response' in auth) return auth.response;

  try {
    const records = await listRevenueRecords(parsed.data.clientId);
    return NextResponse.json({ records });
  } catch (error) {
    return unexpectedError('GET /api/revenue-records', error);
  }
}

/**
 * Internal-only — matches POST /api/leads. There is no client-role UX for
 * creating a manual revenue entry. createdBy/updatedBy are set from the
 * authenticated user's id, never accepted from the request body.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = CreateRevenueRecordBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const record = await createRevenueRecord({ ...parsed.data, createdBy: auth.user.id });
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    if (error instanceof RevenueRecordValidationError) return jsonError(422, error.message, { code: error.code });
    return unexpectedError('POST /api/revenue-records', error);
  }
}

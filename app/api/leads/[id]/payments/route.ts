import { NextResponse } from 'next/server';
import {
  LeadNotFoundError,
  LeadPaymentValidationError,
  getLeadById,
  listLeadPayments,
  recordLeadPayment,
} from '@/lib/server/leads-repo';
import { CreateLeadPaymentBodySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { dispatchMetaCapiLiveEvent } from '@/lib/server/meta-capi-live';

export const dynamic = 'force-dynamic';

/**
 * Lead-level receipts. Internal-only during V1: REKREOS remains the single
 * commercial operator until the client portal gets scoped financial access.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  try {
    if (!(await getLeadById(params.id))) return jsonError(404, 'lead not found');
    const payments = await listLeadPayments(params.id);
    return NextResponse.json({ payments });
  } catch (error) {
    return unexpectedError('GET /api/leads/[id]/payments', error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = CreateLeadPaymentBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const result = await recordLeadPayment({ leadId: params.id, ...parsed.data, createdBy: auth.user.id });
    await dispatchMetaCapiLiveEvent({
      leadId: result.lead.id,
      kind: 'converted',
      occurredAt: new Date(result.payment.occurredAt),
      sourceIdentity: `payment:${result.payment.id}`,
      purchaseValue: result.payment.amount,
      createdBy: auth.user.id,
    }).catch(() => undefined);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof LeadNotFoundError) return jsonError(404, 'lead not found');
    if (error instanceof LeadPaymentValidationError) return jsonError(422, error.message);
    return unexpectedError('POST /api/leads/[id]/payments', error);
  }
}

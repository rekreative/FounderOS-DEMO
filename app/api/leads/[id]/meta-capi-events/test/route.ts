import { NextResponse } from 'next/server';
import {
  LeadNotFoundError,
  MetaCapiLeadValidationError,
  prepareMetaCapiTestDelivery,
  settleMetaCapiTestDelivery,
} from '@/lib/server/leads-repo';
import {
  MetaCapiConfigurationError,
  MetaCapiPayloadValidationError,
  buildMetaCapiTestRequest,
  getMetaCapiConfiguration,
  sendMetaCapiTestRequest,
} from '@/lib/server/meta-capi';
import { CreateMetaCapiTestEventBodySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { jsonError, unexpectedError } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/**
 * Controlled test delivery only. This endpoint is never called by Make,
 * does not mutate a lead's commercial stage, and cannot send a live event:
 * Meta's test code is required on every request.
 */
export async function POST(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = CreateMetaCapiTestEventBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const prepared = await prepareMetaCapiTestDelivery({
      leadId: params.id,
      kind: parsed.data.kind,
      createdBy: auth.user.id,
    });
    if (!prepared.shouldSend) {
      return NextResponse.json({ delivery: prepared.delivery, deduped: true });
    }

    let outcome: Awaited<ReturnType<typeof sendMetaCapiTestRequest>>;
    try {
      const config = getMetaCapiConfiguration();
      const requestBody = buildMetaCapiTestRequest({
        datasetId: config.datasetId,
        graphApiVersion: config.graphApiVersion,
        testEventCode: parsed.data.testEventCode,
        lead: prepared.lead,
        kind: parsed.data.kind,
        // Test mode verifies transport/configuration without claiming a
        // historical CRM occurrence to Meta as a new live conversion.
        occurredAt: new Date(),
      });
      outcome = await sendMetaCapiTestRequest(config, requestBody);
    } catch (error) {
      const errorCode = error instanceof MetaCapiConfigurationError ? 'not_configured' : 'invalid_lead_data';
      const delivery = await settleMetaCapiTestDelivery({ deliveryId: prepared.delivery.id, status: 'failed', errorCode });
      if (error instanceof MetaCapiConfigurationError) return jsonError(503, 'Meta CAPI is not configured', { delivery });
      if (error instanceof MetaCapiPayloadValidationError) return jsonError(422, 'lead cannot be matched by Meta CAPI', { delivery });
      throw error;
    }

    const delivery = await settleMetaCapiTestDelivery({
      deliveryId: prepared.delivery.id,
      status: outcome.status,
      errorCode: outcome.status === 'failed' ? outcome.errorCode : null,
    });
    return NextResponse.json({ delivery, deduped: false }, { status: 201 });
  } catch (error) {
    if (error instanceof LeadNotFoundError) return jsonError(404, 'lead not found');
    if (error instanceof MetaCapiLeadValidationError) return jsonError(422, error.message);
    return unexpectedError('POST /api/leads/[id]/meta-capi-events/test', error);
  }
}

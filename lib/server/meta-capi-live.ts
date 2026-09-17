import {
  LeadNotFoundError,
  MetaCapiLeadValidationError,
  prepareMetaCapiLiveDelivery,
  settleMetaCapiLiveDelivery,
  type LeadMetaCapiDelivery,
} from './leads-repo';
import {
  MetaCapiConfigurationError,
  MetaCapiPayloadValidationError,
  buildMetaCapiLiveRequest,
  getMetaCapiConfiguration,
  isMetaCapiLiveEnabled,
  sendMetaCapiLiveRequest,
  type MetaCapiEventKind,
} from './meta-capi';

export type MetaCapiLiveDispatchResult =
  | { skipped: true; reason: 'disabled' | 'ineligible'; delivery?: undefined }
  | { skipped: false; delivery: LeadMetaCapiDelivery; deduped: boolean };

/**
 * Delivers one approved REKREOS commercial signal to the internal Meta
 * dataset. This runs only after its CRM fact has committed. Provider errors
 * are converted into a durable, visible delivery state and never roll back a
 * qualification, appointment, conversion, or payment already recorded in
 * REKREOS.
 */
export async function dispatchMetaCapiLiveEvent(input: {
  leadId: string;
  kind: MetaCapiEventKind;
  occurredAt: Date;
  sourceIdentity?: string;
  purchaseValue?: number;
  createdBy?: string | null;
}): Promise<MetaCapiLiveDispatchResult> {
  if (!isMetaCapiLiveEnabled()) return { skipped: true, reason: 'disabled' };

  let prepared: Awaited<ReturnType<typeof prepareMetaCapiLiveDelivery>>;
  try {
    prepared = await prepareMetaCapiLiveDelivery(input);
  } catch (error) {
    if (error instanceof MetaCapiLeadValidationError) return { skipped: true, reason: 'ineligible' };
    if (error instanceof LeadNotFoundError) return { skipped: true, reason: 'ineligible' };
    throw error;
  }
  if (!prepared.shouldSend) return { skipped: false, delivery: prepared.delivery, deduped: true };

  try {
    const config = getMetaCapiConfiguration();
    const request = buildMetaCapiLiveRequest({
      datasetId: config.datasetId,
      graphApiVersion: config.graphApiVersion,
      deliveryEventId: prepared.delivery.eventId,
      lead: prepared.lead,
      kind: input.kind,
      // Do not turn a later retry into a newly dated commercial conversion.
      occurredAt: prepared.delivery.eventOccurredAt ? new Date(prepared.delivery.eventOccurredAt) : input.occurredAt,
      purchaseValue: input.purchaseValue,
    });
    const outcome = await sendMetaCapiLiveRequest(config, request);
    const delivery = await settleMetaCapiLiveDelivery({
      deliveryId: prepared.delivery.id,
      status: outcome.status,
      errorCode: outcome.status === 'failed' ? outcome.errorCode : null,
    });
    return { skipped: false, delivery, deduped: false };
  } catch (error) {
    const errorCode =
      error instanceof MetaCapiConfigurationError
        ? 'not_configured'
        : error instanceof MetaCapiPayloadValidationError
          ? 'invalid_lead_data'
          : 'dispatch_error';
    const delivery = await settleMetaCapiLiveDelivery({
      deliveryId: prepared.delivery.id,
      status: 'failed',
      errorCode,
    });
    return { skipped: false, delivery, deduped: false };
  }
}

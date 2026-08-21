import { NextResponse } from 'next/server';
import { checkIngestAuth, type IngestAuthFailureReason } from '@/lib/server/ingest-auth';
import { LeadValidationError, ingestLeadTransactional } from '@/lib/server/leads-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { IngestLeadBodySchema } from '@/lib/server/schemas';

export const dynamic = 'force-dynamic';

const AUTH_ERROR_STATUS: Record<IngestAuthFailureReason, number> = {
  not_configured: 500,
  missing_header: 401,
  malformed_header: 401,
  invalid_token: 401,
};

const AUTH_ERROR_MESSAGE: Record<IngestAuthFailureReason, string> = {
  not_configured: 'ingestion is not configured',
  missing_header: 'unauthorized',
  malformed_header: 'unauthorized',
  invalid_token: 'unauthorized',
};

/**
 * Make → REKREATIVE OS lead ingestion. POST only (no GET is exported, so
 * Next.js answers a GET with its own 405).
 *
 * Auth: see lib/server/ingest-auth.ts — fails closed if INGEST_API_KEY
 * isn't configured, and never reveals which token was expected.
 *
 * Idempotency: delegates entirely to lib/server/leads-repo.ts's
 * ingestLeadTransactional, the single transactional primitive that already
 * implements the approved double idempotency (ingest_delivery_id, then
 * (ingestion_source, external_lead_id)). No pre-check-then-insert logic
 * lives in this route — that would be race-prone.
 *
 * Lifecycle: Make can never choose a lead's stage — IngestLeadBodySchema
 * has no `stage` field at all (`.strict()` rejects one if sent), so every
 * ingested lead starts at the repository's own default.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = checkIngestAuth(request);
  if (!auth.ok) {
    return jsonError(AUTH_ERROR_STATUS[auth.reason], AUTH_ERROR_MESSAGE[auth.reason]);
  }

  const parsed = IngestLeadBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  // leadSource (business/acquisition source) is renamed to the repo's
  // `source` field here — the one place that translation happens, keeping
  // the ingestion contract's explicit field names distinct from the
  // repo/DB's internal naming. aiAnalysis.analyzedAt is always null here —
  // ingestion never supplies it; that field is set only by a real AI
  // qualification pass, not this pass.
  const { leadSource, aiAnalysis, ...rest } = parsed.data;

  try {
    const result = await ingestLeadTransactional({
      ...rest,
      source: leadSource,
      aiAnalysis: aiAnalysis
        ? {
            summary: aiAnalysis.summary ?? null,
            intent: aiAnalysis.intent ?? null,
            priority: aiAnalysis.priority ?? null,
            qualification: aiAnalysis.qualification ?? null,
            analyzedAt: null,
          }
        : null,
    });
    return NextResponse.json(
      { ok: true, leadId: result.lead.id, deduped: result.deduped },
      { status: result.deduped ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof LeadValidationError) return jsonError(422, error.message, { code: error.code });
    return unexpectedError('POST /api/ingest/leads', error);
  }
}

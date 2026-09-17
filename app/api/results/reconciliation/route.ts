import { NextResponse } from 'next/server';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { unexpectedError, jsonError } from '@/lib/server/http';
import { getInternalMetaLeadReconciliation } from '@/lib/server/meta-reconciliation';
import { ResultsPeriodPresetSchema } from '@/lib/server/schemas';
import { resolveResultsPeriod } from '@/lib/server/results-time';

export const dynamic = 'force-dynamic';

/**
 * Internal operational diagnostic. It is intentionally not exposed through
 * the client-access route: V1 reconciles REKREATIVE's own Meta account only.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const preset = url.searchParams.get('preset') ?? 'all';
  const start = url.searchParams.get('start') ?? undefined;
  const end = url.searchParams.get('end') ?? undefined;
  const parsedPreset = ResultsPeriodPresetSchema.safeParse(preset);
  if (!parsedPreset.success) return jsonError(400, 'invalid period preset');
  if ((start && !end) || (!start && end) || (start && end && end < start) || (parsedPreset.data === 'custom' && (!start || !end))) {
    return jsonError(400, 'invalid custom period');
  }
  if ((start || end) && parsedPreset.data !== 'custom') return jsonError(400, 'custom dates require custom preset');

  try {
    const period = resolveResultsPeriod(parsedPreset.data, start && end ? { start, end } : undefined);
    return NextResponse.json({ period, reconciliation: await getInternalMetaLeadReconciliation(period) });
  } catch (error) {
    return unexpectedError('GET /api/results/reconciliation', error);
  }
}

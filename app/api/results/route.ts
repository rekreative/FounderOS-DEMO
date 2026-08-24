import { NextResponse } from 'next/server';
import { getResults } from '@/lib/server/results-repo';
import { unexpectedError, jsonError } from '@/lib/server/http';
import { ResultsQuerySchema } from '@/lib/server/schemas';

export const dynamic = 'force-dynamic';

/**
 * GET /api/results
 * GET /api/results?clientId=client-acme
 * GET /api/results?preset=this_month | last_month | last_30_days | custom
 * GET /api/results?preset=custom&start=2026-08-01&end=2026-08-20
 *
 * Real PostgreSQL Leads/LeadEvents only — funnel, rates, trend, and
 * conversion-value ("Valor generado", never "Ingresos"). Never touches
 * RevenueRecord or MetaCampaign (both stay client-side localStorage; see
 * lib/results.ts) — this endpoint has no ad-spend/ROAS/CAC fields at all, so
 * there is no field here a client could mistake for live Meta Ads data.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = ResultsQuerySchema.safeParse({
    clientId: url.searchParams.get('clientId') ?? undefined,
    preset: url.searchParams.get('preset') ?? undefined,
    start: url.searchParams.get('start') ?? undefined,
    end: url.searchParams.get('end') ?? undefined,
  });
  if (!parsed.success) return jsonError(400, 'invalid query parameters', { issues: parsed.error.flatten() });

  try {
    const result = await getResults({
      clientId: parsed.data.clientId,
      preset: parsed.data.preset ?? 'all',
      customStart: parsed.data.start,
      customEnd: parsed.data.end,
    });
    return NextResponse.json(result);
  } catch (error) {
    return unexpectedError('GET /api/results', error);
  }
}

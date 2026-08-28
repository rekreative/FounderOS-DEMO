import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { unexpectedError } from '@/lib/server/http';
import {
  audienceSeries,
  dmSeries,
  syncFromZernioConfig,
  DM_COLOR,
  GROWTH_RANGES,
} from '@/lib/social';

export const dynamic = 'force-dynamic';

/**
 * Labelled history series for the Social pop-out charts.
 *   ?metric=audience → per-channel + "All audience" follower/subscriber series
 *   ?metric=dms      → total DMs-over-time
 * Growth per range is derived client-side from these points.
 */
export async function GET(request: Request) {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const metric = new URL(request.url).searchParams.get('metric');
  if (metric !== 'audience' && metric !== 'dms') {
    return NextResponse.json({ error: "metric must be 'audience' or 'dms'" }, { status: 400 });
  }

  try {
    const db = getDb();
    syncFromZernioConfig(db);

    if (metric === 'audience') {
      const { channels, all } = audienceSeries(db);
      return NextResponse.json({ metric, ranges: GROWTH_RANGES, series: [all, ...channels] });
    }

    return NextResponse.json({
      metric,
      ranges: GROWTH_RANGES,
      series: [{ key: 'total', label: 'Total DMs', color: DM_COLOR, points: dmSeries(db) }],
    });
  } catch (error) {
    return unexpectedError('GET /api/social/series', error);
  }
}

import { NextResponse } from 'next/server';
import {
  getClientOperationalSnapshot,
  getHighPriorityLeads,
  getLeadsAwaitingFirstContact,
  getRecentActivity,
  getRecentConversions,
  getRecentLeads,
  getUpcomingAppointments,
  getValueGeneratedRecently,
} from '@/lib/server/results-repo';
import { unexpectedError, jsonError } from '@/lib/server/http';
import { ResultsHomeQuerySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 6;
const DEFAULT_VALUE_WINDOW_DAYS = 7;

/**
 * GET /api/results/home
 * GET /api/results/home?limit=8&days=14
 *
 * Home's operational (current-activity) snapshot — event-time semantics,
 * never the acquisition-cohort filtering /api/results uses. Same
 * lib/server/results-repo.ts module as /api/results (one aggregation layer,
 * two HTTP shapes), so counting rules can never drift between the two pages.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const parsed = ResultsHomeQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    days: url.searchParams.get('days') ?? undefined,
  });
  if (!parsed.success) return jsonError(400, 'invalid query parameters', { issues: parsed.error.flatten() });

  const limit = parsed.data.limit ? Number(parsed.data.limit) : DEFAULT_LIMIT;
  const days = parsed.data.days ? Number(parsed.data.days) : DEFAULT_VALUE_WINDOW_DAYS;

  try {
    const [recentLeads, highPriorityLeads, awaitingFirstContact, upcomingAppointments, recentConversions, recentActivity, valueGenerated, clientSnapshot] =
      await Promise.all([
        getRecentLeads(limit),
        getHighPriorityLeads(limit),
        getLeadsAwaitingFirstContact(limit),
        getUpcomingAppointments(limit),
        getRecentConversions(limit),
        getRecentActivity(limit),
        getValueGeneratedRecently(days),
        getClientOperationalSnapshot(),
      ]);

    return NextResponse.json({
      recentLeads,
      highPriorityLeads,
      awaitingFirstContact,
      upcomingAppointments,
      recentConversions,
      recentActivity,
      valueGenerated: { ...valueGenerated, days },
      clientSnapshot,
    });
  } catch (error) {
    return unexpectedError('GET /api/results/home', error);
  }
}

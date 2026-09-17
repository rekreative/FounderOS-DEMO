import { NextResponse } from 'next/server';
import { LeadNotFoundError, getLeadById, listLeadMetaCapiDeliveries } from '@/lib/server/leads-repo';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { jsonError, unexpectedError } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Server-only audit surface for CAPI test delivery states. Client-facing
 * access is intentionally excluded until tenant-specific Meta ownership and
 * portal permissions exist. */
export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  try {
    if (!(await getLeadById(params.id))) throw new LeadNotFoundError(params.id);
    const deliveries = await listLeadMetaCapiDeliveries(params.id);
    return NextResponse.json({ deliveries });
  } catch (error) {
    if (error instanceof LeadNotFoundError) return jsonError(404, 'lead not found');
    return unexpectedError('GET /api/leads/[id]/meta-capi-events', error);
  }
}

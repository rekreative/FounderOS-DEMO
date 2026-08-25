import { NextResponse } from 'next/server';
import { LeadValidationError, createLead, listLeads } from '@/lib/server/leads-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { CreateLeadBodySchema, ListLeadsQuerySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/leads
 * GET /api/leads?clientId=client-acme
 * GET /api/leads?scope=internal | client
 * Filters are applied in SQL (lib/server/leads-repo.ts's listLeads) — never
 * "fetch everything, filter in JS" (that path leaks other clients' rows into
 * memory even if the response later narrows them).
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const parsed = ListLeadsQuerySchema.safeParse({
    clientId: url.searchParams.get('clientId') ?? undefined,
    scope: url.searchParams.get('scope') ?? undefined,
  });
  if (!parsed.success) return jsonError(400, 'invalid query parameters', { issues: parsed.error.flatten() });

  try {
    const leads = await listLeads(parsed.data);
    return NextResponse.json({ leads });
  } catch (error) {
    return unexpectedError('GET /api/leads', error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = CreateLeadBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const { lead, event } = await createLead(parsed.data);
    return NextResponse.json({ lead, event }, { status: 201 });
  } catch (error) {
    if (error instanceof LeadValidationError) return jsonError(422, error.message, { code: error.code });
    return unexpectedError('POST /api/leads', error);
  }
}

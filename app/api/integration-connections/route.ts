import { NextResponse } from 'next/server';
import {
  createIntegrationConnection,
  IntegrationConnectionValidationError,
  listIntegrationConnections,
} from '@/lib/server/integration-connections-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { CreateIntegrationConnectionBodySchema, ListIntegrationConnectionsQuerySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integration-connections
 * GET /api/integration-connections?clientId=client-acme
 * GET /api/integration-connections?status=archived
 *
 * Connections/Secrets V1 — the canonical /connections manual
 * operational-record ledger's new PostgreSQL home, replacing
 * lib/integration-connections.ts's browser-localStorage IntegrationConnection
 * store. Internal-only, both directions — Connections has no client-role UX
 * anywhere in the app today, same posture as GET /api/knowledge-entries.
 * clientId is an optional content filter, not an authorization boundary.
 * status defaults to 'active' inside the repo; archived records require an
 * explicit status=archived request. Deliberately a distinct path from the
 * legacy FounderOS connector marketplace's GET /api/connections — never the
 * same collection, never ambiguous with it.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const parsed = ListIntegrationConnectionsQuerySchema.safeParse({
    clientId: url.searchParams.get('clientId') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
  });
  if (!parsed.success) return jsonError(400, 'invalid query parameters', { issues: parsed.error.flatten() });

  try {
    const connections = await listIntegrationConnections({ clientId: parsed.data.clientId, status: parsed.data.status });
    return NextResponse.json({ connections });
  } catch (error) {
    return unexpectedError('GET /api/integration-connections', error);
  }
}

/** createdBy is set from the authenticated user's id, never accepted from the request body. */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = CreateIntegrationConnectionBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const connection = await createIntegrationConnection({ ...parsed.data, createdBy: auth.user.id });
    return NextResponse.json({ connection }, { status: 201 });
  } catch (error) {
    if (error instanceof IntegrationConnectionValidationError) return jsonError(422, error.message, { code: error.code });
    return unexpectedError('POST /api/integration-connections', error);
  }
}

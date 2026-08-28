import { NextResponse } from 'next/server';
import {
  archiveIntegrationConnection,
  IntegrationConnectionValidationError,
  markIntegrationConnectionFailed,
  markIntegrationConnectionVerified,
  resetIntegrationConnectionVerification,
  restoreIntegrationConnection,
  updateIntegrationConnection,
  type ServerIntegrationConnection,
} from '@/lib/server/integration-connections-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { UpdateIntegrationConnectionBodySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/integration-connections/[id]
 *
 * Internal-only, same as GET/POST (see route.ts's doc comment). Supports
 * exactly one mutation family per request via the `action` discriminant
 * (UpdateIntegrationConnectionBodySchema — a strict discriminated union, so
 * an empty or mixed request is structurally rejected by the schema, not
 * just by handler logic):
 *  - action: 'edit'    — business fields only (scope/clientId/platform/name/
 *    externalRef/externalLabel/notes)
 *  - action: 'verify'  — verification state; status targets 'verified' |
 *    'failed' | 'not_verified'. Method ('manual') and the verification
 *    timestamp are always derived server-side, never accepted from the body.
 *  - action: 'archive' — archive state; status targets 'active' | 'archived'.
 * updatedBy is set from the authenticated user's id, never accepted from the
 * request body. No DELETE endpoint — archive is the only way to retire a
 * record; there is no hard delete in V1.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = UpdateIntegrationConnectionBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  const userId = auth.user.id;
  const body = parsed.data;

  try {
    let connection: ServerIntegrationConnection | null;

    if (body.action === 'edit') {
      const { action: _action, ...patch } = body;
      connection = await updateIntegrationConnection(params.id, { ...patch, updatedBy: userId });
    } else if (body.action === 'verify') {
      connection =
        body.status === 'verified'
          ? await markIntegrationConnectionVerified(params.id, userId)
          : body.status === 'failed'
            ? await markIntegrationConnectionFailed(params.id, userId)
            : await resetIntegrationConnectionVerification(params.id, userId);
    } else {
      connection =
        body.status === 'archived'
          ? await archiveIntegrationConnection(params.id, userId)
          : await restoreIntegrationConnection(params.id, userId);
    }

    if (!connection) return jsonError(404, 'integration connection not found');
    return NextResponse.json({ connection });
  } catch (error) {
    if (error instanceof IntegrationConnectionValidationError) return jsonError(422, error.message, { code: error.code });
    return unexpectedError('PATCH /api/integration-connections/[id]', error);
  }
}

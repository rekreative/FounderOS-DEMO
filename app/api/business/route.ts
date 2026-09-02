import { NextResponse } from 'next/server';
import { getInternalBusinessWorkspace, saveInternalBusinessWorkspace } from '@/lib/server/business-repo';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { SaveInternalBusinessWorkspaceBodySchema } from '@/lib/server/schemas';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;
  try {
    return NextResponse.json(await getInternalBusinessWorkspace());
  } catch (error) {
    return unexpectedError('GET /api/business', error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;
  const parsed = SaveInternalBusinessWorkspaceBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });
  try {
    return NextResponse.json(await saveInternalBusinessWorkspace(parsed.data, auth.user.id));
  } catch (error) {
    return unexpectedError('PUT /api/business', error);
  }
}

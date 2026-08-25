import { NextResponse } from 'next/server';
import { createClient, listClients } from '@/lib/server/clients-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { CreateClientBodySchema } from '@/lib/server/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  try {
    const clients = await listClients();
    return NextResponse.json({ clients });
  } catch (error) {
    return unexpectedError('GET /api/clients', error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = CreateClientBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const client = await createClient(parsed.data);
    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    return unexpectedError('POST /api/clients', error);
  }
}

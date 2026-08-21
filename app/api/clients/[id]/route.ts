import { NextResponse } from 'next/server';
import { deleteClient, getClientById, updateClient } from '@/lib/server/clients-repo';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { UpdateClientBodySchema } from '@/lib/server/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const client = await getClientById(params.id);
    if (!client) return jsonError(404, 'client not found');
    return NextResponse.json({ client });
  } catch (error) {
    return unexpectedError('GET /api/clients/[id]', error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const parsed = UpdateClientBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const client = await updateClient(params.id, parsed.data);
    if (!client) return jsonError(404, 'client not found');
    return NextResponse.json({ client });
  } catch (error) {
    return unexpectedError('PATCH /api/clients/[id]', error);
  }
}

/**
 * leads.client_id is ON DELETE RESTRICT — a client with leads is never
 * cascade-deleted, never silently orphans its leads' client_id to NULL.
 * deleteClient() turns that into a structured result; this just maps it to
 * the right status code.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const result = await deleteClient(params.id);
    if (result.outcome === 'not_found') return jsonError(404, 'client not found');
    if (result.outcome === 'blocked') {
      return jsonError(409, 'client has existing leads and cannot be deleted', { leadCount: result.leadCount });
    }
    return NextResponse.json({ ok: true, id: params.id });
  } catch (error) {
    return unexpectedError('DELETE /api/clients/[id]', error);
  }
}

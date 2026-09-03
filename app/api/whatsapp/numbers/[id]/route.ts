import { NextResponse } from 'next/server';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { jsonError, unexpectedError } from '@/lib/server/http';
import { UpdateWhatsAppBusinessNumberBodySchema } from '@/lib/server/schemas';
import { updateWhatsAppBusinessNumber } from '@/lib/server/whatsapp-repo';

export const dynamic = 'force-dynamic';

function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = UpdateWhatsAppBusinessNumberBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const number = await updateWhatsAppBusinessNumber(params.id, parsed.data);
    if (!number) return jsonError(404, 'WhatsApp business number mapping not found');
    return NextResponse.json({ number });
  } catch (error) {
    if (pgCode(error) === '23P01') {
      return jsonError(422, 'this Phone Number ID already has an overlapping ownership mapping');
    }
    if (pgCode(error) === '23514') return jsonError(422, 'invalid WhatsApp business number validity interval');
    return unexpectedError('PATCH /api/whatsapp/numbers/[id]', error);
  }
}

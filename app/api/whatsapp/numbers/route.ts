import { NextResponse } from 'next/server';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { jsonError, unexpectedError } from '@/lib/server/http';
import {
  CreateWhatsAppBusinessNumberBodySchema,
  ListWhatsAppBusinessNumbersQuerySchema,
} from '@/lib/server/schemas';
import { createWhatsAppBusinessNumber, listWhatsAppBusinessNumbers } from '@/lib/server/whatsapp-repo';

export const dynamic = 'force-dynamic';

function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = ListWhatsAppBusinessNumbersQuerySchema.safeParse({
    ownerScope: url.searchParams.get('ownerScope') ?? undefined,
    clientId: url.searchParams.get('clientId') ?? undefined,
  });
  if (!parsed.success) return jsonError(400, 'invalid query', { issues: parsed.error.flatten() });

  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  try {
    const numbers = await listWhatsAppBusinessNumbers(parsed.data);
    return NextResponse.json({ numbers });
  } catch (error) {
    return unexpectedError('GET /api/whatsapp/numbers', error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = CreateWhatsAppBusinessNumberBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'invalid request body', { issues: parsed.error.flatten() });

  try {
    const number = await createWhatsAppBusinessNumber(parsed.data);
    return NextResponse.json({ number }, { status: 201 });
  } catch (error) {
    if (pgCode(error) === '23503') return jsonError(422, 'unknown client id');
    if (pgCode(error) === '23P01' || pgCode(error) === '23505') {
      return jsonError(422, 'this Phone Number ID already has an overlapping ownership mapping');
    }
    return unexpectedError('POST /api/whatsapp/numbers', error);
  }
}

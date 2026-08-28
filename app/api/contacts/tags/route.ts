import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { CONTACT_TIERS } from '@/lib/life-map';
import { ContactTagSchema } from '@/lib/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { unexpectedError } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  try {
    return NextResponse.json({ tiers: CONTACT_TIERS, tags: getDb().contactTags.all() });
  } catch (error) {
    return unexpectedError('GET /api/contacts/tags', error);
  }
}

export async function POST(request: Request) {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = ContactTagSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    getDb().contactTags.upsert(parsed.data);
    return NextResponse.json({ ok: true, tag: parsed.data });
  } catch (error) {
    return unexpectedError('POST /api/contacts/tags', error);
  }
}

const RemoveSchema = z.object({ person: z.string().min(1), channel: z.string().min(1) });

export async function DELETE(request: Request) {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const parsed = RemoveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    getDb().contactTags.remove(parsed.data.person, parsed.data.channel);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return unexpectedError('DELETE /api/contacts/tags', error);
  }
}

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const db = getDb();
  return NextResponse.json({ tools: db.tools.all() });
}

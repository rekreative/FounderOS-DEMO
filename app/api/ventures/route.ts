import { NextResponse } from 'next/server';
import { VENTURES } from '@/lib/ventures';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  return NextResponse.json({ ventures: VENTURES });
}

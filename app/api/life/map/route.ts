import { NextResponse } from 'next/server';
import { buildLifeMap } from '@/lib/life-map';
import { LifeMapSchema } from '@/lib/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  return NextResponse.json(LifeMapSchema.parse(buildLifeMap()));
}

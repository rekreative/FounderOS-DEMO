import { NextResponse } from 'next/server';
import { gatherCommsFeed } from '@/lib/comms-feed';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const feed = await gatherCommsFeed();
  return NextResponse.json({ feed });
}

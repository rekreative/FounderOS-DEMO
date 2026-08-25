import { NextResponse } from 'next/server';
import { createGBrainProvider } from '@/lib/connectors/gbrain';
import { BrainOverviewSchema } from '@/lib/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const overview = await createGBrainProvider().overview();
  return NextResponse.json(BrainOverviewSchema.parse(overview));
}

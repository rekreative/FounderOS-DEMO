import { NextResponse } from 'next/server';
import { readStoreNotes } from '@/lib/connectors/gbrain';
import { buildBrainGraph } from '@/lib/brain-graph';
import { BrainGraphSchema } from '@/lib/schemas';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const graph = buildBrainGraph(readStoreNotes());
  return NextResponse.json(BrainGraphSchema.parse(graph));
}

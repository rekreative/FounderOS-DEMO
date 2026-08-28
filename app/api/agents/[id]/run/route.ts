import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { createRuntime } from '@/lib/agents/runtime';
import { realAgents } from '@/lib/agents/real';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { unexpectedError } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  // Resolved up front, same pre-check pattern as the sibling
  // /api/agents/[id]/chat route: createRuntime(...).run() throws the same
  // "unknown agent" Error for a bad id and for any other unexpected
  // failure, so this route can no longer tell them apart once inside the
  // try below. Deciding the 404 here, before entering the operational
  // boundary, keeps that response honest and stops a genuine DB failure
  // from being reported as "not found" with its raw message attached.
  if (!realAgents.some((a) => a.id === params.id)) {
    return NextResponse.json({ error: `unknown agent: ${params.id}` }, { status: 404 });
  }

  try {
    const runtime = createRuntime(getDb(), realAgents);
    const run = await runtime.run(params.id);
    return NextResponse.json({ run });
  } catch (error) {
    return unexpectedError('POST /api/agents/[id]/run', error);
  }
}

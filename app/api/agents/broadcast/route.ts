import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { createRuntime } from '@/lib/agents/runtime';
import { realAgents } from '@/lib/agents/real';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { unexpectedError } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  try {
    return NextResponse.json({ broadcasts: getDb().broadcasts.recent(10) });
  } catch (error) {
    return unexpectedError('GET /api/agents/broadcast', error);
  }
}

export async function POST(req: Request) {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  let message = '';
  try {
    const body = (await req.json()) as { message?: unknown };
    message = typeof body.message === 'string' ? body.message.trim() : '';
  } catch {
    // fall through to the empty-message rejection
  }
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  try {
    const runtime = createRuntime(getDb(), realAgents);
    const broadcast = await runtime.broadcast(message);
    return NextResponse.json({ broadcast });
  } catch (error) {
    return unexpectedError('POST /api/agents/broadcast', error);
  }
}

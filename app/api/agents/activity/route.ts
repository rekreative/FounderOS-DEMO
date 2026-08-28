import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { recentActivity } from '@/lib/agents/activity';
import { requireInternalUserOrResponse } from '@/lib/server/api-auth';
import { unexpectedError } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // better-sqlite3 is native — keep off the edge runtime

export async function GET(req: Request) {
  const auth = await requireInternalUserOrResponse();
  if ('response' in auth) return auth.response;

  const raw = Number(new URL(req.url).searchParams.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 50;
  try {
    return NextResponse.json({ events: recentActivity(getDb(), limit) });
  } catch (error) {
    return unexpectedError('GET /api/agents/activity', error);
  }
}

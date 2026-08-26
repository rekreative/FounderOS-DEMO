import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { parseManyChatWebhook } from '@/lib/connectors/manychat-webhook';
import { checkManyChatAuth, type ManyChatAuthFailureReason } from '@/lib/server/manychat-auth';
import { jsonError } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const AUTH_ERROR_STATUS: Record<ManyChatAuthFailureReason, number> = {
  not_configured: 500,
  missing_header: 401,
  invalid_token: 401,
};

const AUTH_ERROR_MESSAGE: Record<ManyChatAuthFailureReason, string> = {
  not_configured: 'manychat webhook is not configured',
  missing_header: 'unauthorized',
  invalid_token: 'unauthorized',
};

/**
 * ManyChat "External Request" ingest. ManyChat's API can't be polled for DMs,
 * so this push endpoint is how the /social Instagram DM inbox goes live: point a
 * ManyChat automation's External Request (POST) at this URL with a JSON body
 * carrying the contact + message. Each message upserts by id, so replays don't
 * duplicate.
 *
 * Auth: see lib/server/manychat-auth.ts — fails closed if
 * MANYCHAT_WEBHOOK_SECRET isn't configured, and never reveals whether a
 * supplied `x-manychat-secret` header was missing or wrong.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = checkManyChatAuth(request);
  if (!auth.ok) {
    return jsonError(AUTH_ERROR_STATUS[auth.reason], AUTH_ERROR_MESSAGE[auth.reason]);
  }

  const raw = await request.json().catch(() => null);
  const message = parseManyChatWebhook(raw);
  if (!message) {
    return NextResponse.json({ error: 'payload missing a subscriber id' }, { status: 400 });
  }

  getDb().social.upsertDmMessage(message);
  return NextResponse.json({ ok: true, id: message.id, subscriberId: message.subscriberId });
}

/**
 * Lightweight liveness ping for this route only — not the deployment health
 * check (see /api/health for that). Unauthenticated by design (ManyChat's
 * own dashboard may probe it), so it returns no counts or other stored-data
 * detail, only that the route is reachable.
 */
export async function GET(): Promise<Response> {
  return NextResponse.json({ ok: true, endpoint: 'manychat-webhook' });
}

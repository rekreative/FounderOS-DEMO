import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Bearer-token gate for POST /api/leads/whatsapp-events. Deliberately a
 * dedicated key (MAKE_EVENTS_API_KEY), never INGEST_API_KEY — the ingestion
 * key can create new leads; this one can only append events/advance stage
 * on leads that already exist, and the two should be rotatable
 * independently. Same fail-closed / constant-time principles as
 * lib/server/ingest-auth.ts: if MAKE_EVENTS_API_KEY isn't configured, every
 * request is rejected regardless of what token it carries. Never logs the
 * Authorization header, the bearer token, or MAKE_EVENTS_API_KEY anywhere.
 */

function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export type MakeEventsAuthFailureReason = 'not_configured' | 'missing_header' | 'malformed_header' | 'invalid_token';

export type MakeEventsAuthResult = { ok: true } | { ok: false; reason: MakeEventsAuthFailureReason };

export function checkMakeEventsAuth(request: Request): MakeEventsAuthResult {
  const expected = process.env.MAKE_EVENTS_API_KEY;
  if (!expected) return { ok: false, reason: 'not_configured' };

  const header = request.headers.get('authorization');
  if (!header) return { ok: false, reason: 'missing_header' };

  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return { ok: false, reason: 'malformed_header' };

  const token = match[1].trim();
  if (!token || !constantTimeEquals(token, expected)) return { ok: false, reason: 'invalid_token' };

  return { ok: true };
}

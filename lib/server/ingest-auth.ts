import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Bearer-token gate for POST /api/ingest/leads. Fails closed: if
 * INGEST_API_KEY isn't configured, every request is rejected regardless of
 * what token it carries — a missing server secret must never silently
 * accept ingestion. Never logs the Authorization header, the bearer token,
 * or INGEST_API_KEY anywhere.
 */

/**
 * Hashes both sides to a fixed-length digest before comparing, so
 * crypto.timingSafeEqual (which throws on unequal-length buffers) never
 * needs a length check that would itself leak timing information about the
 * real secret's length.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export type IngestAuthFailureReason = 'not_configured' | 'missing_header' | 'malformed_header' | 'invalid_token';

export type IngestAuthResult = { ok: true } | { ok: false; reason: IngestAuthFailureReason };

export function checkIngestAuth(request: Request): IngestAuthResult {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return { ok: false, reason: 'not_configured' };

  const header = request.headers.get('authorization');
  if (!header) return { ok: false, reason: 'missing_header' };

  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return { ok: false, reason: 'malformed_header' };

  const token = match[1].trim();
  if (!token || !constantTimeEquals(token, expected)) return { ok: false, reason: 'invalid_token' };

  return { ok: true };
}

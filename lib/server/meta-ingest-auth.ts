import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Bearer-token gate for POST /api/ingest/meta-metrics. Deliberately a
 * dedicated key (INGEST_META_API_KEY), never INGEST_API_KEY or
 * MAKE_EVENTS_API_KEY — this key can only write daily campaign-metric
 * snapshots, never create/mutate a lead, and should be rotatable
 * independently of both. Same fail-closed / constant-time principles as
 * lib/server/ingest-auth.ts and lib/server/make-events-auth.ts: if
 * INGEST_META_API_KEY isn't configured, every request is rejected regardless
 * of what token it carries. Never logs the Authorization header, the bearer
 * token, or INGEST_META_API_KEY anywhere.
 */

function constantTimeEquals(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export type MetaIngestAuthFailureReason = 'not_configured' | 'missing_header' | 'malformed_header' | 'invalid_token';

export type MetaIngestAuthResult = { ok: true } | { ok: false; reason: MetaIngestAuthFailureReason };

export function checkMetaIngestAuth(request: Request): MetaIngestAuthResult {
  const expected = process.env.INGEST_META_API_KEY;
  if (!expected) return { ok: false, reason: 'not_configured' };

  const header = request.headers.get('authorization');
  if (!header) return { ok: false, reason: 'missing_header' };

  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return { ok: false, reason: 'malformed_header' };

  const token = match[1].trim();
  if (!token || !constantTimeEquals(token, expected)) return { ok: false, reason: 'invalid_token' };

  return { ok: true };
}

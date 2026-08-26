import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Shared-secret gate for POST /api/webhooks/manychat. Fails closed: if
 * MANYCHAT_WEBHOOK_SECRET isn't configured, every request is rejected
 * regardless of what header it carries — a missing server secret must never
 * silently accept a webhook post. Never logs the `x-manychat-secret` header
 * or MANYCHAT_WEBHOOK_SECRET anywhere.
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

export type ManyChatAuthFailureReason = 'not_configured' | 'missing_header' | 'invalid_token';

export type ManyChatAuthResult = { ok: true } | { ok: false; reason: ManyChatAuthFailureReason };

export function checkManyChatAuth(request: Request): ManyChatAuthResult {
  const expected = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (!expected) return { ok: false, reason: 'not_configured' };

  const header = request.headers.get('x-manychat-secret');
  if (!header) return { ok: false, reason: 'missing_header' };

  if (!constantTimeEquals(header, expected)) return { ok: false, reason: 'invalid_token' };

  return { ok: true };
}

import { afterEach, describe, expect, it } from 'vitest';
import { checkManyChatAuth } from '@/lib/server/manychat-auth';

describe('checkManyChatAuth', () => {
  const originalSecret = process.env.MANYCHAT_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.MANYCHAT_WEBHOOK_SECRET;
    else process.env.MANYCHAT_WEBHOOK_SECRET = originalSecret;
  });

  const req = (headers: Record<string, string> = {}) => new Request('http://x/api/webhooks/manychat', { method: 'POST', headers });

  it('fails closed when MANYCHAT_WEBHOOK_SECRET is not configured, regardless of the header sent', () => {
    delete process.env.MANYCHAT_WEBHOOK_SECRET;
    expect(checkManyChatAuth(req({ 'x-manychat-secret': 'whatever' }))).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('fails closed when MANYCHAT_WEBHOOK_SECRET is blank', () => {
    process.env.MANYCHAT_WEBHOOK_SECRET = '';
    expect(checkManyChatAuth(req({ 'x-manychat-secret': '' }))).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('rejects a missing x-manychat-secret header', () => {
    process.env.MANYCHAT_WEBHOOK_SECRET = 'secret-key';
    expect(checkManyChatAuth(req())).toEqual({ ok: false, reason: 'missing_header' });
  });

  it('rejects the wrong secret', () => {
    process.env.MANYCHAT_WEBHOOK_SECRET = 'secret-key';
    expect(checkManyChatAuth(req({ 'x-manychat-secret': 'wrong-secret' }))).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('accepts the correct secret', () => {
    process.env.MANYCHAT_WEBHOOK_SECRET = 'secret-key';
    expect(checkManyChatAuth(req({ 'x-manychat-secret': 'secret-key' }))).toEqual({ ok: true });
  });
});

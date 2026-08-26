import { beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Own temp DB so ingest is observable in isolation. Secret read at request
// time, so tests can toggle MANYCHAT_WEBHOOK_SECRET between calls.
beforeAll(() => {
  process.env.FOUNDER_OS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'alex-mc-wh-')), 'test.db');
  delete process.env.MANYCHAT_WEBHOOK_SECRET;
});

const URL = 'http://localhost/api/webhooks/manychat';
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(URL, { method: 'POST', headers, body: JSON.stringify(body) });

describe('POST /api/webhooks/manychat', () => {
  test('rejects with 500 when MANYCHAT_WEBHOOK_SECRET is not configured, and does not write', async () => {
    delete process.env.MANYCHAT_WEBHOOK_SECRET;
    const { POST } = await import('@/app/api/webhooks/manychat/route');
    const res = await POST(post({ subscriber_id: 'no-config', text: 'hi' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('manychat webhook is not configured');

    const { getDb } = await import('@/lib/data');
    expect(getDb().social.dmMessages('instagram').find((m) => m.subscriberId === 'no-config')).toBeUndefined();
  });

  test('rejects with 401 when the secret is configured but x-manychat-secret is missing, and does not write', async () => {
    process.env.MANYCHAT_WEBHOOK_SECRET = 's3cret';
    const { POST } = await import('@/app/api/webhooks/manychat/route');
    const res = await POST(post({ subscriber_id: 'no-header', text: 'hi' }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unauthorized');

    const { getDb } = await import('@/lib/data');
    expect(getDb().social.dmMessages('instagram').find((m) => m.subscriberId === 'no-header')).toBeUndefined();
    delete process.env.MANYCHAT_WEBHOOK_SECRET;
  });

  test('rejects with 401 when x-manychat-secret is wrong, and does not write', async () => {
    process.env.MANYCHAT_WEBHOOK_SECRET = 's3cret';
    const { POST } = await import('@/app/api/webhooks/manychat/route');
    const res = await POST(post({ subscriber_id: 'wrong-secret', text: 'hi' }, { 'x-manychat-secret': 'nope' }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unauthorized');

    const { getDb } = await import('@/lib/data');
    expect(getDb().social.dmMessages('instagram').find((m) => m.subscriberId === 'wrong-secret')).toBeUndefined();
    delete process.env.MANYCHAT_WEBHOOK_SECRET;
  });

  test('ingests a DM and it lands in the inbox as source=manychat when the secret is correct', async () => {
    process.env.MANYCHAT_WEBHOOK_SECRET = 's3cret';
    const { POST } = await import('@/app/api/webhooks/manychat/route');
    const res = await POST(
      post(
        { subscriber_id: 'wh-1', name: 'Webhook Wendy', handle: 'wendy', text: 'came from manychat', ts: '2026-07-18T16:00:00.000Z' },
        { 'x-manychat-secret': 's3cret' },
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const { getDb } = await import('@/lib/data');
    const found = getDb().social.dmMessages('instagram').find((m) => m.subscriberId === 'wh-1');
    expect(found?.text).toBe('came from manychat');
    expect(found?.source).toBe('manychat');
    delete process.env.MANYCHAT_WEBHOOK_SECRET;
  });

  test('rejects an unparseable payload with 400 when the secret is correct', async () => {
    process.env.MANYCHAT_WEBHOOK_SECRET = 's3cret';
    const { POST } = await import('@/app/api/webhooks/manychat/route');
    const res = await POST(post({ text: 'no subscriber id' }, { 'x-manychat-secret': 's3cret' }));
    expect(res.status).toBe(400);
    delete process.env.MANYCHAT_WEBHOOK_SECRET;
  });
});

describe('GET /api/webhooks/manychat', () => {
  test('does not expose whether MANYCHAT_WEBHOOK_SECRET is configured', async () => {
    process.env.MANYCHAT_WEBHOOK_SECRET = 's3cret';
    const { GET } = await import('@/app/api/webhooks/manychat/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('secured');
    expect(body).toMatchObject({ ok: true, endpoint: 'manychat-webhook' });
    expect(typeof body.stored).toBe('number');
    delete process.env.MANYCHAT_WEBHOOK_SECRET;
  });
});

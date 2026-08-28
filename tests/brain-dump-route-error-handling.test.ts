import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/brain/dump — targeted fix for the one confirmed raw-error leak
 * outside the SQLite-backed inventory covered by
 * tests/sqlite-route-error-handling.test.ts (brain/dump writes through
 * lib/brain-dump.ts's ingestBrainDump(), never getDb(), so it does not
 * belong in that SQLite-only inventory table). Mocks only the route's own
 * ingestBrainDump import — never a real filesystem write, gbrain capture,
 * or network call.
 */

const FAKE_SECRET_DETAIL =
  'write failed: EACCES at /var/secret/brain-store/inbox/note.md (api_key=sk-fake-secret-12345)';

describe('POST /api/brain/dump — unexpected write failure', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/brain-dump');
    vi.resetModules();
  });

  it('returns the safe unexpectedError() body, never the raw write-failure detail, path, or fake secret', async () => {
    vi.doMock('@/lib/brain-dump', () => ({
      ingestBrainDump: () => {
        throw new Error(FAKE_SECRET_DETAIL);
      },
    }));

    const { POST } = await import('@/app/api/brain/dump/route');
    const res = await POST(
      new Request('http://x/api/brain/dump', {
        method: 'POST',
        body: JSON.stringify({ text: 'test capture', folder: 'inbox', tags: [] }),
        headers: { 'content-type': 'application/json' },
      }),
    );

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toEqual({ error: 'internal server error' });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(FAKE_SECRET_DETAIL);
    expect(serialized).not.toContain('sk-fake-secret-12345');
    expect(serialized).not.toContain('/var/secret');
    expect(serialized).not.toMatch(/[/\\]/);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { checkMetaIngestAuth } from '@/lib/server/meta-ingest-auth';

describe('checkMetaIngestAuth', () => {
  const originalKey = process.env.INGEST_META_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.INGEST_META_API_KEY;
    else process.env.INGEST_META_API_KEY = originalKey;
  });

  const req = (headers: Record<string, string> = {}) => new Request('http://x/api/ingest/meta-metrics', { method: 'POST', headers });

  it('fails closed when INGEST_META_API_KEY is not configured, regardless of the header sent', () => {
    delete process.env.INGEST_META_API_KEY;
    expect(checkMetaIngestAuth(req({ authorization: 'Bearer whatever' }))).toEqual({ ok: false, reason: 'not_configured' });
  });

  it('rejects a missing Authorization header', () => {
    process.env.INGEST_META_API_KEY = 'secret-key';
    expect(checkMetaIngestAuth(req())).toEqual({ ok: false, reason: 'missing_header' });
  });

  it('rejects a malformed (non-Bearer) Authorization header', () => {
    process.env.INGEST_META_API_KEY = 'secret-key';
    expect(checkMetaIngestAuth(req({ authorization: 'Basic abc123' }))).toEqual({ ok: false, reason: 'malformed_header' });
  });

  it('rejects the wrong token', () => {
    process.env.INGEST_META_API_KEY = 'secret-key';
    expect(checkMetaIngestAuth(req({ authorization: 'Bearer wrong-token' }))).toEqual({ ok: false, reason: 'invalid_token' });
  });

  it('accepts the correct token', () => {
    process.env.INGEST_META_API_KEY = 'secret-key';
    expect(checkMetaIngestAuth(req({ authorization: 'Bearer secret-key' }))).toEqual({ ok: true });
  });

  it('is independent of INGEST_API_KEY — a valid leads-ingestion key must not authenticate Meta metrics ingestion', () => {
    process.env.INGEST_META_API_KEY = 'meta-secret';
    process.env.INGEST_API_KEY = 'leads-secret';
    expect(checkMetaIngestAuth(req({ authorization: 'Bearer leads-secret' }))).toEqual({ ok: false, reason: 'invalid_token' });
    delete process.env.INGEST_API_KEY;
  });
});

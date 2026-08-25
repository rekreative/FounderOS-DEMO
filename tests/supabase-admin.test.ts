import { afterEach, describe, expect, it } from 'vitest';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

describe('getSupabaseAdminClient', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SECRET_KEY;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = originalKey;
  });

  it('creates a client when both env vars are set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_value';

    const client = getSupabaseAdminClient();
    expect(client).toBeTruthy();
    expect(client.auth.admin).toBeTruthy();
  });

  it('throws a clear, explicit error naming the variable when NEXT_PUBLIC_SUPABASE_URL is missing — never the SUPABASE_SECRET_KEY value', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_should_never_appear_in_any_error';

    let thrown: unknown;
    try {
      getSupabaseAdminClient();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/NEXT_PUBLIC_SUPABASE_URL is not set/);
    expect((thrown as Error).message).not.toContain('sb_secret_should_never_appear_in_any_error');
  });

  it('throws a clear, explicit error naming the variable when SUPABASE_SECRET_KEY is missing — never leaks the URL value into a suspicious place either', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.SUPABASE_SECRET_KEY;

    expect(() => getSupabaseAdminClient()).toThrow(/SUPABASE_SECRET_KEY is not set/);
  });
});

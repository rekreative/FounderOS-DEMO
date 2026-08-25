import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

const { getSupabaseServerClient } = await import('@/lib/supabase/server');

describe('getSupabaseServerClient', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  });

  it('throws a clear, explicit error when NEXT_PUBLIC_SUPABASE_URL is missing — checked before cookies() is ever called', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

    expect(() => getSupabaseServerClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not set/);
  });

  it('throws a clear, explicit error when NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(() => getSupabaseServerClient()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set/);
  });

  it('creates a new client on every call — never a module-level singleton, since each instance is bound to one request\'s cookies', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

    const first = getSupabaseServerClient();
    const second = getSupabaseServerClient();

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });
});

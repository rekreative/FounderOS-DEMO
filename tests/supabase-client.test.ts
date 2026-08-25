import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

describe('getSupabaseBrowserClient', () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  });

  it('creates a client when both env vars are set', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

    const client = getSupabaseBrowserClient();
    expect(client).toBeTruthy();
    expect(client.auth).toBeTruthy();
  });

  it('throws a clear, explicit error when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

    expect(() => getSupabaseBrowserClient()).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not set/);
  });

  it('throws a clear, explicit error when NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(() => getSupabaseBrowserClient()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set/);
  });
});

describe('NEXT_PUBLIC_* env access shape (source-level guard)', () => {
  // Next.js inlines NEXT_PUBLIC_* variables at build time via a source-text
  // replacement that only recognizes a literal, static
  // `process.env.NEXT_PUBLIC_X` expression — it cannot see through dynamic
  // access like `process.env[name]` where `name` is a runtime variable.
  // That exact pattern shipped once (a shared readPublicEnv(name) helper)
  // and silently broke the browser client: it worked perfectly under this
  // very test suite's real, fully dynamic Node process.env, and only failed
  // in an actual browser bundle, where an unreplaced dynamic access reads
  // an empty polyfill stub instead of the real value. A Node/Vitest runtime
  // test — including every other test in this file — CANNOT catch that
  // class of bug on its own, because Vitest never runs Next's build-time
  // inlining pass; only a real `next build` (or, cheaply and reliably here,
  // asserting the literal shape of the source itself) can. This test
  // guards the shape, not runtime behavior — it does not by itself prove
  // the browser bundle is correct; a real npm run dev + browser retest
  // remains the authoritative confirmation.
  const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'supabase', 'client.ts'), 'utf8');
  // Block comments (including this file's own JSDoc, which documents the
  // old buggy process.env[name] shape as history) must not confuse the
  // "no dynamic access in actual code" check below — strip them first.
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, '');

  it('references NEXT_PUBLIC_SUPABASE_URL as a literal, static process.env.X expression', () => {
    expect(codeOnly).toMatch(/process\.env\.NEXT_PUBLIC_SUPABASE_URL\b/);
  });

  it('references NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as a literal, static process.env.X expression', () => {
    expect(codeOnly).toMatch(/process\.env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\b/);
  });

  it('never reads a NEXT_PUBLIC_ variable through dynamic bracket access (process.env[name]) — the exact pattern that caused this bug', () => {
    expect(codeOnly).not.toMatch(/process\.env\[/);
  });
});

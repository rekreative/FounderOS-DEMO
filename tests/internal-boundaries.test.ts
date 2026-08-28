import { createElement } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * app/(internal)/loading.tsx and app/(internal)/error.tsx — the route-segment
 * boundaries added so a slow or failing app/(internal)/layout.tsx (its
 * requireInternalUser() call) is a skeleton or a retry screen, never a blank
 * tab (Observability Phase 1). No jsdom in this suite (vitest.config.ts's
 * `environment: 'node'`, same as tests/topbar-logout.test.ts) — renderToStaticMarkup
 * proves each component mounts without throwing; retry-wiring and
 * no-raw-message guarantees are checked as source contracts, same pattern
 * tests/topbar-logout.test.ts already uses for LogoutButton.tsx.
 */

describe('app/(internal)/loading.tsx', () => {
  it('renders a skeleton without throwing, no data fetching or client directive', async () => {
    const { default: InternalLoading } = await import('@/app/(internal)/loading');

    let markup = '';
    expect(() => {
      markup = renderToStaticMarkup(createElement(InternalLoading));
    }).not.toThrow();
    expect(markup).toContain('animate-pulse');

    const source = fs.readFileSync(path.join(process.cwd(), 'app', '(internal)', 'loading.tsx'), 'utf8');
    expect(source).not.toContain("'use client'"); // pure skeleton, no hooks/fetch needed
  });
});

describe('app/(internal)/error.tsx', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app', '(internal)', 'error.tsx'), 'utf8');

  it('is a valid client component (required for a Next.js error.tsx boundary)', () => {
    expect(source.trimStart().startsWith("'use client'")).toBe(true);
  });

  it('wires the retry button to reset()', () => {
    expect(source).toMatch(/onClick=\{?\s*\(\)\s*=>\s*reset\(\)/);
  });

  it('never interpolates the raw error message or stack into JSX output', () => {
    // Regex, not a plain substring check: this file's own doc comment
    // mentions "error.message"/"error.stack" by name to explain why they're
    // avoided, which a bare .not.toContain() would false-positive on.
    expect(source).not.toMatch(/\{error\.message\}/);
    expect(source).not.toMatch(/\{error\.stack\}/);
    expect(source).not.toMatch(/\{\s*error\.message\s*\}/);
    expect(source).not.toMatch(/\{\s*error\.stack\s*\}/);
  });

  it('renders without throwing, given a synthetic error + reset, and never leaks the message into markup', async () => {
    const { default: InternalError } = await import('@/app/(internal)/error');
    const secretError = Object.assign(new Error('leaked db path or stack trace should never appear'), {
      digest: 'test-digest-123',
    });
    let resetCalled = false;

    let markup = '';
    expect(() => {
      markup = renderToStaticMarkup(
        createElement(InternalError, { error: secretError, reset: () => (resetCalled = true) }),
      );
    }).not.toThrow();

    expect(markup).not.toContain('leaked db path or stack trace');
    expect(markup).toContain('test-digest-123'); // safe, opaque reference is fine to show
    expect(markup.toLowerCase()).toContain('retry');
    expect(resetCalled).toBe(false); // never called merely by rendering
  });
});

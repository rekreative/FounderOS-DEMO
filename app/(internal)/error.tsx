'use client';

import { useEffect } from 'react';
import { Badge } from '@/components/terminal';

/**
 * Route-segment error boundary for the internal shell. Catches any throw
 * from a Server Component in this tree - e.g. an unexpected, non-AuthError
 * failure out of app/(internal)/layout.tsx's requireInternalUser() - that
 * would otherwise leave a blank tab with no recovery path (see the
 * Observability Phase 1 audit). Never renders error.message or error.stack:
 * only error.digest, which Next.js generates specifically as a safe, opaque
 * reference for matching against server logs, never the raw failure detail.
 */
export default function InternalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[internal-error]', error.digest ?? 'no-digest');
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <Badge tone="err">Error</Badge>
      <h1 className="font-mono text-[13px] font-bold uppercase tracking-[0.14em] text-os-text">
        Something went wrong
      </h1>
      <p className="max-w-[420px] font-mono text-[11px] text-os-muted">
        This screen failed to load. No internal details are shown here.
        {error.digest && <> Reference: {error.digest}.</>}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="border border-os-border-strong bg-os-accent px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-os-ink"
      >
        Retry
      </button>
    </div>
  );
}

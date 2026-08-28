/**
 * Route-segment loading UI for the internal shell. Shown while
 * app/(internal)/layout.tsx's requireInternalUser() (a Supabase + Postgres
 * round trip - see the Observability Phase 1 audit) is in flight, so a slow
 * auth check is a visible skeleton, never a blank tab. This does not make
 * that check faster; it only gives it visible feedback and matches the
 * existing animate-pulse skeleton convention (see components/BrainGraphView.tsx).
 */
export default function InternalLoading() {
  return (
    <div className="animate-pulse space-y-3" role="status" aria-label="Loading">
      <div className="h-4 w-40 rounded-sm-t bg-os-surface" />
      <div className="h-24 w-full rounded-lg-t border border-os-border bg-os-surface" />
      <div className="h-24 w-full rounded-lg-t border border-os-border bg-os-surface" />
    </div>
  );
}

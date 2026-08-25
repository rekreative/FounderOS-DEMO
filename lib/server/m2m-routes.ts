/**
 * The single source of truth for which API routes are machine-to-machine —
 * exact paths only, never a prefix, so a future human-facing route added
 * under an already-excluded-sounding path (e.g. a route under /api/leads/)
 * can never be silently swept in. Imported by middleware.ts (to bypass both
 * the legacy deployment gate and the Supabase human-session perimeter for
 * these paths) and by tests/api-auth-inventory.test.ts (to verify every
 * OTHER internal-human route is wired to requireInternalUserOrResponse(),
 * and that these exact routes are NOT). Reviewed, approved list — see the
 * Session Refresh + Internal Route Protection V1 architecture audit.
 */
export const M2M_PATHS: ReadonlySet<string> = new Set([
  '/api/ingest/leads',
  '/api/ingest/meta-metrics',
  '/api/leads/whatsapp-events',
  '/api/leads/commercial-events',
  '/api/webhooks/manychat',
]);

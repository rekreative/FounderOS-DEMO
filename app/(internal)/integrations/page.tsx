import { redirect } from 'next/navigation';

/**
 * Legacy FounderOS connector marketplace — retired as a user-facing REKREOS
 * Phase 1 screen (Visual QA correction, 2026-08-28): it duplicated the
 * canonical /connections board, was visually/linguistically inconsistent
 * with REKREOS, listed tools outside the real REKREATIVE operating model,
 * and still surfaced local .env.local setup guidance. Redirects to the
 * canonical board instead of rendering anything here. No marketplace UI,
 * connect/disconnect affordance, or key-management surface remains — see
 * the Legacy secret-write shutdown (Connections/Secrets V1) for the removal
 * of the write paths themselves.
 */
export default function IntegrationsPage() {
  redirect('/connections');
}

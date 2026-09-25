# EROS lifecycle repair, 2026-09-25

## Publication gate

Prepared on `fix/eros-lifecycle`, from deployed commit `9b626cd97db8a7e5b39c774c9137b73b7b5e0cbd`. No production deployment, production database write, remote push, or customer invitation performed. User authorization to publish the shared application was requested separately and has not yet been received.

This isolated clone's origin is the local canonical repository, NOT GitHub. Verify the live GitHub main SHA and obtain publication approval before pushing or integrating. Do not deploy the stale canonical local main checkout.

## Repairs

- Make commercial events accept `appointment_confirmed`, `appointment_cancelled`, and `appointment_no_show`, with a required appointment occurrence date and an external deduplication key.
- Confirmation records an activity, not a new pipeline stage. Cancelled/no-show clears only a matching appointment date; delayed events cannot clear a newer rescheduled booking or undo a conversion.
- An explicit `collectedAmount` on a client conversion creates an auditable `lead_payments` receipt atomically. Old value-only conversions still do not represent cash. Concurrent retries record only one receipt; a new external key cannot double-charge an already-collected conversion.
- Internal service/payment-plan rules remain unchanged. New receipt input is rejected for internal leads or mixed internal payment terms.
- Add Spanish activity labels to the internal and client lead views. No new manual portal action is introduced.
- Migration `0021_appointment_outcomes.sql` extends only the existing event-type constraint. Production already has an out-of-repository migration `0020_appointment_status_events_v1.sql`; do not reuse that filename or blindly replay other migrations.

## Make changes saved, still inactive

Only EROS scenarios were changed:

- `7612357`: serialize the full Meta data object using JSON module 14, then include its JSON string under `qualificationAnswers["Respuestas del formulario"]`. Keeps all answers, not separate normalized answer keys. Preserves the temporary test-phone and consented-form WhatsApp filters.
- `7612582`: add confirmation to the existing appointment outcome route, send occurrence dates and distinct deduplication identities for confirmation/cancellation/no-show, and pass explicit collectedAmount from Citas column P for conversion.
- `7612371`: cancellation carries its occurrence date and deduplication identity; sheet cancellation can be repaired even if REKREOS has already accepted the same event.

No scenarios were run or activated during this repair. `7612370` and `7612348` were not edited. All five were read back as inactive with zero incomplete executions; intake and CRM webhook queues both had zero deliveries waiting.

These saved Make changes REQUIRE the new application version. Do not activate against the currently deployed commercial-events endpoint.

## Verification

- General suite without external PostgreSQL: 196 files passed, 24 skipped; 2137 tests passed, 416 skipped. Skips are not passes.
- TypeScript check passed.
- Targeted integration coverage on disposable local PostgreSQL: 153 passed across appointment outcomes, commercial events, lead ingestion and WhatsApp events.
- After applying the final migration filename locally: 85 passed across migration tests, schema tests and appointment PostgreSQL tests.
- A broader PostgreSQL run was not fully green: its minimal local auth fixture lacked columns expected by unrelated suites, a revenue fixture used a non-UUID actor, and an agent test timed out. No unrelated production code was changed to hide those failures.
- Full local build initially failed because this isolated clone intentionally has no production environment values. Final build passed with loopback Supabase URL and a non-secret placeholder for NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. This is a compilation check only: never deploy that local artifact; Railway must rebuild with its existing real environment.
- The disposable local PostgreSQL server was stopped after testing; no production connection was used for tests.

## Required next steps

1. Obtain explicit publication approval, recheck GitHub main and Railway revision, and review the additive database migration against the current constraint.
2. Publish the reviewed change and apply only the intended pending migration with bounded locking. Verify application health before any Make run.
3. Retest the actual Make payloads and date/amount formatting using the existing EROS test contact only. Local API tests do not prove Make runtime mappings.
4. Verify actual serialized answers and repeat-lead deduplication without a second WhatsApp. Do not erase the existing lead's message evidence.
5. Retest confirmation, cancellation, no-show, rescheduling and an explicitly fictitious receipt. Clean only exact newly created test event/payment IDs, and restore the documented original contact baseline.
6. Check Calendar start cursors before activation; the editor still warns that a start point is not recorded. No historical replay should be authorized implicitly.
7. Decide and validate reminders, final WhatsApp status monitoring, and EROS CAPI separately. They are not implemented by this repair.
8. Test missing-email and late-added-invitee cases; the previously proven Calendar link requires the lead's email at creation.
9. Recheck the Meta campaign, last observed PAUSED, and validate metrics with an active campaign. Do not activate the campaign without approval.
10. Remove the temporary Kilian-only phone filter only at approved production launch, preserving consent checks. Do not invite Abdula until Kilian is with him on a call and asks.

## Unrelated security findings

Read-only Supabase advisories include missing-policy notices on RLS tables, mutable function search paths, a public extension, `rls_auto_enable` executable by anonymous/authenticated roles despite SECURITY DEFINER, and disabled leaked-password protection. No RLS, grant, function, authentication or extension changes were made. Review these as a separate scoped security task; do not treat this repair as a clean security audit.

Official remediation reference for the function warning: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable

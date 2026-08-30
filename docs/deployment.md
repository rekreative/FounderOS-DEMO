# Deployment

Repository-preparation notes for Deployment Prep V1. This is not a deploy
runbook and does not provision any Railway resources — it documents what the
current architecture requires so a manual deploy/QA pass can follow it.

## Target

**Railway** — a long-running Node service (`npm run build` → `npm run
start`, see [scripts/start-standalone.js](../scripts/start-standalone.js))
with a **persistent volume**, plus Supabase for PostgreSQL + Auth. This
matches the current architecture (a native SQLite layer and a `pg.Pool`
singleton tuned for one long-lived process) without requiring a serverless
rewrite. See the Deployment Prep V1 read-only audit for the full platform
comparison and rationale (Vercel's ephemeral filesystem is unsafe for the
SQLite layer below; Railway/Render/Fly.io all work, Railway has the least
setup overhead for this app today).

## REKREOS requires persistent filesystem storage

This is the single most important fact for whoever deploys this app: **it
is not stateless.** A large, currently-live slice of the app — `/agents`,
`/org`, `/social`, `/roadmap`, `/comms`, `/funnel`, lead magnets, and the
ManyChat DM inbox fed by `POST /api/webhooks/manychat` — reads and writes
through a `better-sqlite3` file at:

```
data/founder-os.db      # default; override via FOUNDER_OS_DB
```

`lib/bank.ts` and `lib/ledger.ts` maintain their own separate SQLite files
under `data/` the same way (`BANK_DB`, `LEDGER_DB`). All of them are WAL-mode
files resolved relative to `process.cwd()`, auto-created/seeded on first
touch, and gitignored (never committed).

**A Railway volume must be attached and mounted so it covers the `data/`
directory** (or wherever `FOUNDER_OS_DB`/`BANK_DB`/`LEDGER_DB` point). This
must be configured in the Railway UI/project settings — it is not something
this repository's config-as-code can safely express (see
[Railway config](#railway-config-as-code) below).

### Mandatory Railway path variables

Do not rely on the `process.cwd()/data` default (see `lib/data.ts`,
`lib/bank.ts`, `lib/ledger.ts`) in production. It is unsafe under Next.js
`output: 'standalone'`: the generated `server.js` changes its own process's
working directory to the standalone output folder on startup, so by the time
a route first touches `getDb()`, `process.cwd()` no longer points at the
repository root Railway mounts the volume onto. This was observed directly
in production - before these variables were set, `founder-os.db` was created
under `/app/.next/standalone/data`, not the mounted volume at `/app/data`,
so every write was silently going to the container's ephemeral filesystem
instead of persistent storage.

The fix is to set explicit absolute paths so no code path ever falls back to
`process.cwd()`. Set all three as Railway service variables:

```
FOUNDER_OS_DB=/app/data/founder-os.db
BANK_DB=/app/data/bank.db
LEDGER_DB=/app/data/ledger.db
```

`/app/data` is the persistent volume mount point for this service - the
directory the Railway volume must cover, per the mount requirement above.
After setting these three variables and redeploying, `founder-os.db` was
confirmed created under `/app/data` on first visit to `/agents` (`GET
/agents` triggers `getDb()`'s first touch, per `lib/data.ts`).

**Deploying this architecture to an ephemeral or serverless filesystem
(e.g. Vercel's default) is unsafe today.** Each cold start would reseed
`data/founder-os.db` from scratch and silently lose everything written since
— including inbound ManyChat DMs, org/roadmap edits, and lead-magnet state.
This audit did not migrate SQLite to Postgres/object storage; that is a
larger architectural change explicitly out of scope for this milestone.

## Supabase remains the PostgreSQL/Auth backend

- **Auth**: `@supabase/ssr`, cookie-based, checked in `middleware.ts`
  (session presence only — Edge can't reach Postgres) and in
  `app/(internal)/layout.tsx` (role/tenant authorization, via `pg`).
- **Postgres**: `lib/server/db.ts`'s `pg.Pool` (max 10 connections),
  singleton-anchored on `globalThis` to survive Next.js dev hot-reload. In
  production, point `DATABASE_URL` at Supabase's **Session Pooler**
  connection string — see `.env.example` for the exact shape. `lib/server/db.ts`
  issues no named prepared statements, so transaction-mode pgbouncer is also
  safe if ever needed.
- **TLS (Supabase TLS V1)**: production sets `SUPABASE_CA_PEM` (the public
  Supabase Root 2021 CA cert — not a secret) so `lib/server/db.ts` passes an
  explicit `ssl: { ca, rejectUnauthorized: true }` to the pool, verifying the
  Session Pooler's certificate chain against Supabase's real CA rather than
  either trusting nothing or skipping verification. Production's
  `DATABASE_URL` must NOT carry `sslmode`/`uselibpqcompat` — pg-connection-string
  re-parses the connection string and merges it in after this explicit `ssl`
  config, so those query params would silently override it. When
  `SUPABASE_CA_PEM` is unset (local dev), `ssl` is omitted entirely and
  behavior is unchanged from before.
- **Migrations**: manual only. `npm run db:migrate` runs
  `lib/server/migrate.ts`, which is guarded so importing it never runs
  anything — nothing in this app runs migrations automatically on boot. Run
  it by hand against production `DATABASE_URL` before each deploy that ships
  a schema change; rely on Supabase's own automated backups / point-in-time
  restore as the rollback safety net.

### Real-Postgres integration tests must never target DATABASE_URL

`DATABASE_URL` (from `process.env` or `.env.local`) is this application's
own connection string - production or local dev, whichever this
installation points it at. It is **not** a safe target for the
real-Postgres integration test suite (`describe.runIf(Boolean(...))` blocks
across `tests/*.test.ts`, gated through `tests/helpers/pg-test-env.ts`):
those tests apply real migrations and freely create/drop/mutate rows. In at
least one known installation, `.env.local`'s `DATABASE_URL` was confirmed
byte-for-byte identical to Railway's production `DATABASE_URL` - a helper
that fell back to either would let a routine test run mutate production.

`tests/helpers/pg-test-env.ts`'s `resolveTestDatabaseUrl()`/
`installTestDatabaseUrl()` enforce this:

- The only source ever trusted is the explicit `TEST_DATABASE_URL`
  environment variable - never `process.env.DATABASE_URL`, never
  `.env.local`'s `DATABASE_URL`, never any other application credential
  fallback.
- Missing `TEST_DATABASE_URL` is not an error - every real-Postgres
  integration test skips cleanly and only mocked/unit tests run.
- If `TEST_DATABASE_URL` ever equals `DATABASE_URL` (from `process.env` or
  `.env.local`), the helper throws a fixed, safe configuration error
  instead of running - this is a misconfiguration to fix, not something to
  silently skip past.
- `TEST_DATABASE_URL` must point at a `localhost`/`127.0.0.1`/`::1` host by
  default. A remote test database additionally requires the explicit
  `ALLOW_REMOTE_TEST_DATABASE=true` opt-in.
- Nothing this helper does ever prints a URL, username, password, host,
  path, or stack - every failure is a fixed, generic message.

See `.env.example`'s `TEST_DATABASE_URL`/`ALLOW_REMOTE_TEST_DATABASE`
entries for the exact setup. `TEST_DATABASE_URL` must name a separate,
disposable database you are fine wiping - never production, and never
whatever `DATABASE_URL` already points at.

## Domain

No canonical `BASE_URL`/`APP_URL` exists in this app today, and none is
introduced by this milestone — nothing in the current codebase constructs an
outbound absolute URL. Defer introducing one until Portal V1 needs to build
invitation-link or redirect URLs back to the deployed domain.

## Make (M2M) endpoints

Cloudflare Quick Tunnel is **development-only** — no code depends on it (no
`trycloudflare.com` reference anywhere in the repo), and none of the 5 M2M
route files hardcode `localhost`. After deployment, update each of the 5
Make.com HTTP modules to call the stable production HTTPS domain instead of
the tunnel hostname:

```
POST /api/ingest/leads
POST /api/ingest/meta-metrics
POST /api/leads/whatsapp-events
POST /api/leads/commercial-events
POST /api/webhooks/manychat
```

Same paths, same header names (`Authorization: Bearer <key>` for the first
four, `x-manychat-secret` for ManyChat), same secret values as configured in
the deployment's environment variables — no code change required for this
swap.

## Health check vs. readiness check

Liveness and DB readiness are deliberately separate endpoints, because a
transient/temporary database issue must not cause Railway to kill an
otherwise-healthy Next.js process:

- `GET /api/health` — **process liveness**. Unauthenticated, minimal
  (`{ ok: true }`, always HTTP 200 as long as the process can serve a
  request). Touches nothing — no `DATABASE_URL`, no Postgres, no
  filesystem. This is the endpoint Railway's `healthcheckPath`
  (`railway.toml`) actually probes; if the DB is briefly unreachable, the
  process still reports healthy and Railway keeps the replica up.
- `GET /api/ready` — **application/database readiness**. Unauthenticated,
  returns `{ ok, checks: { postgres, sqlite } }`, HTTP 200 when `ok` is true
  and HTTP 503 otherwise. No raw error detail, path, or stack ever appears
  in the body. Useful for diagnostics and external monitoring, but **not**
  consulted by Railway to decide whether to keep the process alive.
  - `checks.postgres` is `"ok"` or `"error"` - pings Postgres via the same
    `SELECT 1` primitive `lib/server/ops-status.ts` uses. Always required.
  - `checks.sqlite` is `"not_required"`, `"ok"`, or `"error"`. It is
    `"not_required"` (and never affects the overall `ok`) unless
    `FOUNDER_OS_REQUIRE_EXISTING_DB=true` is set - see "Production SQLite
    recreation guard" below. When required, the check opens founder-os.db
    read-only with `fileMustExist: true` and forces one cheap page read
    (`PRAGMA schema_version`) - never a full `integrity_check` on a probe
    path. `bank.db`/`ledger.db` stay optional and are never checked here.
    Implemented in `lib/server/sqlite-ready.ts`, deliberately independent of
    `lib/data.ts`'s `getDb()`, which would auto-create/seed a missing file
    instead of reporting it as not ready.

Both are exact-match public routes - see `middleware.ts`'s
`PUBLIC_STATUS_PATHS` exception, which lets them bypass the optional legacy
`FOUNDER_OS_ACCESS_TOKEN` gate and the Supabase session check.

## SQLite backups and off-volume archives

Railway's native volume backups are **not** purchased for this project.
`data/founder-os.db`, `data/bank.db`, and `data/ledger.db` are backed up
with the application-level snapshot tool below. Nothing runs on boot or
deploy. A local scheduled automation can run the full off-volume cycle with
`scripts/archive-production-backup.ps1`; it uses the operator's existing
Railway CLI login and never stores a Railway token in this repository. See
`lib/backup.ts`, `lib/backup-archive.ts`, and the scripts under `scripts/`.

### Running a backup

```
npm run backup:sqlite
```

`founder-os.db` is required. `bank.db` and `ledger.db` are optional: both
are separate, independently-created stores (see `lib/bank.ts` and
`lib/ledger.ts`) that legitimately do not exist until a finance statement
has been viewed or uploaded in the app. A backup run does not require them
to exist.

What it does, in order:

1. **Preflight**: opens each source database read-only
   (`fileMustExist: true`, so an existing-but-unreadable file throws instead
   of silently creating an empty replacement, and a forced first-page read
   catches a corrupt/non-SQLite file too). `founder-os.db` is required - if
   it is missing or unreadable, the run aborts immediately with a non-zero
   exit and creates **no** files at all. `bank.db`/`ledger.db` are optional -
   a missing one is not a failure, but an existing-and-unreadable one still
   aborts the run the same as a required source, since "optional" means "may
   be absent", never "may be corrupt".
2. **Collision check**: only for sources that will actually produce a
   snapshot this run (the ones that passed preflight), plus the manifest. If
   a snapshot or manifest filename for the run id about to be used already
   exists on disk, the run aborts immediately and creates no files. A backup
   never overwrites a previous set.
3. **Snapshot**: for each source that exists, calls `better-sqlite3`'s
   `Database#backup()` (the wrapped SQLite Online Backup API), which
   produces a transactionally consistent copy of a live WAL-mode database
   without stopping the app or requiring a manual checkpoint. Snapshots land
   in `data/backups/<name>-<timestamp>.db`, where `<timestamp>` is a
   filesystem-safe UTC ISO-8601 string with every `:` replaced by `-`
   (for example `founder-os-2026-08-28T14-32-05.123Z.db`).
4. **Verify**: runs `PRAGMA integrity_check` against each snapshot and
   computes its SHA-256. If integrity_check, the checksum, the size stat, or
   the row-count inspection throws after the snapshot file was already
   created, that failure is caught per source: the snapshot file is kept on
   disk as failed-run evidence, and the run is marked failed rather than
   crashing partway through.
   - **Sidecar cleanup**: every source database runs `PRAGMA journal_mode =
     WAL`, and the Online Backup API copies the source's raw page 1
     verbatim, so the destination snapshot inherits the WAL-format flag even
     though no separate WAL file was ever written for it during the backup
     itself. Reading the snapshot back for integrity_check and row counts
     then makes SQLite create real `-wal`/`-shm` sidecars for it, purely as a
     read-time side effect - this is exactly what produced the
     `founder-os-<timestamp>.db-shm` and zero-byte
     `founder-os-<timestamp>.db-wal` seen in the first real backup's
     downloaded directory. After inspection, a zero-byte WAL and its SHM are
     deleted; a non-empty WAL means the `.db` file alone may not be the true
     final state, so it is never silently deleted - that source's entry is
     marked `verification_failed` instead, and the snapshot, WAL, and SHM
     are all preserved as evidence. Sidecar paths are only ever derived by
     appending onto an already-validated owned snapshot filename, never from
     a directory scan or glob, and this step never touches the source
     database's own WAL/SHM files.
5. **Manifest**: writes one `data/backups/manifest-<timestamp>.json` with
   exactly one entry per known source (`founder-os`, `bank`, `ledger`),
   always. A source that was actually backed up records: source name, source
   path, snapshot filename, byte size, timestamp, SHA-256, and integrity
   result (or the error, for a source that failed verification). The
   founder-os.db entry additionally records row counts for
   `agent_messages`, `agent_runs`, and `broadcasts`, the tables flagged as
   unbounded-growth risks, so growth is visible in every run without needing
   a separate query. An optional source that does not exist yet gets a
   `not_present` entry instead: no filename, no byte size, no checksum, no
   row counts. The overall run is `ok` only when `founder-os` is `ok` and
   every optional source is either `ok` or `not_present` - never when any
   entry recorded an actual failure.
6. **Retention**: only when the run is `ok`, keeps the latest 3 successful
   backup sets under `data/backups/` and deletes the snapshot and manifest
   files of any older successful sets. A manifest is only trusted for
   retention if it is structurally exact: its own filename matches its
   declared run id, it lists exactly one entry per known source with no
   duplicates and no unexpected sources, the founder-os entry is `ok` with
   its exact owned filename, and each optional entry is either `ok` with its
   exact owned filename or `not_present` with no filename and no file
   metadata attached (a `not_present` entry carrying a filename or any
   byte size/checksum/integrity/row-count data is rejected, along with the
   whole manifest). Deletion additionally only ever unlinks a path whose
   resolved parent directory is exactly the resolved backups directory, so a
   source `.db`, an unowned `-wal`/`-shm` sidecar, a file outside
   `data/backups/`, or any manifest that fails validation is never a
   deletion candidate, and a `not_present` entry never causes a file to be
   invented or deleted. Deleting an older set's snapshot also removes any
   `-wal`/`-shm` sidecar still sitting next to it (a successful run already
   cleans its own during step 4, but this catches sidecars left by an older
   backup or a manual restore) - each sidecar name is derived only by
   appending onto that set's own validated snapshot filename, never a glob.
   A run that fails verification skips retention entirely, so failed-run
   evidence is never auto-deleted.

`data/backups/` is gitignored (`.gitignore`); it must never be committed.

**This is on-volume, temporary retention only.** A backup that never leaves
the Railway volume is not a real backup (the volume is exactly what is at
risk of loss). Getting snapshots off the volume is a separate, manual step
below.

### Downloading a backup off the volume

Verified against the `railway` CLI for this project's linked service:

```
railway.cmd service files download /app/data/backups <LOCAL_DESTINATION>
```

Replace `<LOCAL_DESTINATION>` with wherever you want the files saved on your
own machine. There is no fixed or default local path; choose one at the
time you run the command (for example an external drive, a
password-protected archive location, or wherever your own off-volume backup
habit lives). This downloads the entire `data/backups/` directory (every
kept snapshot and manifest) for that run's manual archival. Run this after
a `npm run backup:sqlite` that reported success.

### Automated off-volume archive on Windows

The supported zero-additional-service-cost automation is:

```
npm run backup:production -- -DestinationRoot C:\Users\Kilian\REKREOS-Backups
```

It performs the complete production cycle in one command:

1. Runs `npm run backup:sqlite` inside the linked Railway service.
2. Extracts exactly one successful run id from the remote command.
3. Downloads that run's manifest into a temporary local directory.
4. Treats the manifest as untrusted and validates its run id, exact source
   set, statuses, owned filenames, sizes, integrity result, and SHA-256 shape
   before using any filename from it.
5. Downloads only the validated snapshots from that manifest.
6. Recomputes size and SHA-256 and runs `PRAGMA integrity_check` locally.
7. Renames the temporary directory to its final run id only after every
   verification passes. A failed partial download is preserved with a
   `.failed-<run-id>` name for diagnosis.
8. Writes `latest-status.json` in the destination root. `ok: true` means a
   complete verified off-volume archive exists; a failure writes `ok: false`
   and a fixed non-secret category and exits non-zero, allowing a scheduler
   to alert the operator.

The destination must be outside this Git checkout and should itself be
backed up or synced to another device. The command never deletes local
archives automatically.

This automation depends on the Windows machine being powered on, connected,
and still authenticated with the Railway CLI. A missed run does not execute
inside Railway. For a client installation that needs 24/7 recovery without
operator-machine dependency, enable Railway's native scheduled volume
backups or add a separately managed object-storage archive. Railway's native
backups can be scheduled daily, weekly, or monthly, but wiping a volume also
deletes its Railway backups and they restore only within the same project
and environment. Keep at least one independently downloaded archive even
when native backups are enabled.

### Restoring a snapshot

1. **Stop or isolate the application.** Restoring while the app is actively
   writing to the live `.db` file risks corrupting the restore.
2. **Verify before trusting it**: re-run `PRAGMA integrity_check` against
   the chosen snapshot and recompute its SHA-256, comparing against the
   value recorded in that run's `manifest-<timestamp>.json`. Do not restore
   a snapshot whose checksum or integrity result does not match its
   manifest entry.
3. **Restore**: copy the verified `data/backups/<name>-<timestamp>.db` over
   `data/<name>.db`.
4. **Remove stale sidecars belonging only to the restored database.** Delete
   `data/<name>.db-wal` and `data/<name>.db-shm` if present. The restored
   file is a plain single-file snapshot with no WAL of its own, so stale
   sidecars from the previous file must not be left behind. Never touch the
   WAL/SHM files of the other two databases, which are unaffected by this
   restore.
5. **Restart** the application.
6. **Verify health/readiness and application data**: check `GET /api/health`
   (process liveness) and `GET /api/ready` (Postgres readiness, unrelated to
   SQLite but confirms the process came back up cleanly), then spot-check
   the restored subsystem in the UI (for example `/agents`, `/social`,
   `/content/lead-magnets`, or `/finances`, depending on which database was
   restored) against what the manifest's row counts and summaries would
   predict.

### First recovery drill (verified)

The first real backup on the production volume, run after the Railway path
variables above were set and `founder-os.db` was confirmed created under
`/app/data`:

- run id: `2026-08-28T15-54-51.085Z`
- founder-os snapshot SHA-256:
  `d5908b223c93ae21d82ea55236bc083175376ee3660eac89393c785f539b48cb`
- integrity check: ok
- isolated restore (a separate, disposable copy - never the live
  production database): 6 departments, 30 agents, 0 agent_messages,
  integrity ok

This confirms the full loop end to end on real production data: a manual
backup run, a `railway.cmd service files download` off the volume, and an
isolated restore that opens and reads the downloaded snapshot without ever
touching the live database. Treat this as the first completed recovery
drill for this project - repeat it periodically rather than trusting the
mechanism to still work untested.

### Production SQLite recreation guard

`getDb()` (`lib/data.ts`) cannot on its own distinguish "this is a genuinely
new environment's first boot" from "the production volume was lost and
recreated" - both look identical from inside the app: an empty database that
gets auto-seeded. A marker row stored inside `founder-os.db` itself, or
inside PostgreSQL, was considered and rejected for Phase 1: an in-SQLite
marker disappears with the exact volume loss it would need to detect, and a
Postgres-side marker adds a schema change, a new dependency between two
otherwise-independent stores, and a product decision (what happens at boot
when Postgres itself is unreachable) that is its own scope, not this one.

The Phase 1 fix instead uses an explicit, non-secret environment flag:

```
FOUNDER_OS_REQUIRE_EXISTING_DB=true
```

When set to exactly `true`, `getDb()` refuses to auto-create or seed
founder-os.db if the file configured by `FOUNDER_OS_DB` does not already
exist on disk - it throws a dedicated error (`FounderDbMissingError`, no
path or other detail in its message) instead. `GET /api/ready` also honors
this flag: when set, it opens founder-os.db read-only and reports
`checks.sqlite: "error"` (503 overall) if the file is missing or will not
open, instead of silently reporting ready. See `lib/server/sqlite-ready.ts`.

With the flag unset (the default for local dev, CI, and tests), behavior is
completely unchanged: a missing founder-os.db is still auto-created and
seeded on first touch, and `/api/ready` reports `checks.sqlite:
"not_required"`.

**Production rollout order** (do not skip or reorder these steps):

1. Confirm `/app/data/founder-os.db` already exists on the Railway volume
   (it does today, per the recovery drill above).
2. Deploy the guard and readiness code (this change) with the flag still
   unset - this is a no-op deploy for production behavior.
3. Enable `FOUNDER_OS_REQUIRE_EXISTING_DB=true` as a Railway service
   variable.
4. Redeploy.
5. Verify `GET /api/ready` returns `checks.sqlite: "ok"` and `ok: true`.

**Rollback**: unset `FOUNDER_OS_REQUIRE_EXISTING_DB` (or set it to anything
other than exactly `true`) and redeploy. This immediately restores today's
auto-create-and-seed behavior with no other change required.

### Removing demo and test data for real onboarding

Production must disable both demo sources before any deletion:

```
FOUNDER_OS_SEED_DEMO_DATA=false
NEXT_PUBLIC_REKREOS_DEMO_DATA=false
```

The first flag prevents `getDb()` from filling an empty SQLite business
store again. The second is compiled into the browser bundle and prevents
the legacy localStorage boards from recreating their demo rows. On first
load it removes records explicitly marked `dataSource: "demo"`, plus the
three obsolete client ids `client-acme`, `client-northwind`, and
`client-lumen`. Manual records are retained.

Use the production reset only after a fresh off-volume backup reports
`ok: true`. The command is a dry run unless both `--execute` and the exact
state token printed by that dry run are supplied:

```
npm run reset:production-data -- --sqlite-path /app/data/founder-os.db
npm run reset:production-data -- --sqlite-path /app/data/founder-os.db --execute --confirm <token-from-dry-run>
```

The token fingerprints both Postgres and SQLite. Any row change between
the dry run and execution makes the token stale and aborts the reset. The
reset deletes business/demo rows but preserves Supabase users and profiles,
database schemas and migrations, both installation markers, all backup
files, and the internal Make connection with id
`connection-mtcs133b-844`. After execution, verify `/api/ready`, inspect the
empty business screens, and create another verified backup as the clean
onboarding baseline.

The two databases cannot share one distributed transaction. The command
verifies both stores before starting and verifies each deletion, but an
infrastructure failure between their commits can leave a partial reset.
That is why the fresh verified backup is mandatory and why the command is
never automatic at startup or deployment.

This flag detects a missing file, not a restored-but-stale volume. The more
precise check - recording a small "last known SQLite install id" in
Postgres, durable and independent of the Railway volume, and comparing
against it at boot - is implemented separately below as REKREOS Phase 2.

### Installation marker (REKREOS Phase 2)

Phase 1's flag above answers "does founder-os.db exist?" but cannot answer
"is this the *same* founder-os.db as before?" - a volume that was lost and
recreated, or a file substituted from an unrelated backup, still "exists"
and opens fine, so Phase 1 reports it as healthy. Phase 2 closes that gap
with a stable installation UUID stored in **both** databases and compared
at boot:

- **SQLite half**: a small, dedicated `installation_metadata` table inside
  founder-os.db (singleton row, key `'founder-os'`) - see
  `lib/server/sqlite-installation.ts`. Deliberately separate from every
  seeded business table; ordinary `getDb()` calls never read or write it.
- **Postgres half**: the `sqlite_installations` table added by migration
  `lib/server/migrations/0009_sqlite_installations.sql` (singleton row,
  same key, RLS enabled with zero policies - the same defensive posture as
  every other table in this schema). Not auto-seeded; production starts
  with zero rows.
- **Registration**: `npm run register:installation -- --sqlite-path <path>`
  (`scripts/register-installation.ts` / `lib/server/installation-registration.ts`)
  is an explicit, idempotent, human-run CLI - never run automatically on
  boot or deploy, and it never creates a missing database. Requires an
  explicit `--sqlite-path`; it never guesses or defaults to a location.
  Safe-state behavior:
  - neither marker exists -> generates one UUID, writes it to SQLite, then
    registers the same UUID in Postgres.
  - both exist and match -> succeeds as a no-op.
  - SQLite marker exists, Postgres marker absent -> completes an
    interrupted registration using the existing SQLite UUID.
  - Postgres marker exists, SQLite marker absent -> hard fails; never
    "blesses" the current SQLite file by inventing a marker for it.
  - both exist but differ -> hard fails; overwrites neither marker.
  - SQLite missing, corrupt, unreadable, or `:memory:` -> hard fails,
    before Postgres is ever touched.
  Every failure preserves whatever markers already existed - registration
  never overwrites an identity. Console output never prints a path, UUID,
  or `DATABASE_URL`.
- **Startup verification**: `FOUNDER_OS_VERIFY_INSTALLATION=true` (see
  `.env.example`). When set to exactly `"true"`:
  - `FOUNDER_OS_REQUIRE_EXISTING_DB=true` is required as defense in depth -
    enabling verification without it is treated as a misconfiguration and
    fails closed.
  - `scripts/verify-installation.js` runs inside `scripts/start-standalone.js`
    **before** `server.js` is spawned - a failed check means the process
    never comes up at all, rather than starting against a bad database.
    Plain CommonJS, no TypeScript/tsx dependency, since only compiled JS
    plus `node_modules` (not a TypeScript toolchain) is guaranteed present
    in the standalone Railway build.
  - Opens founder-os.db read-only (`fileMustExist: true`), reads its
    installation UUID, reads the Postgres marker, and fails closed if
    either is absent, malformed, duplicated, or unreadable, if Postgres is
    unreachable, or if the two values differ. It never creates, seeds,
    modifies, or repairs anything.
  - Every SQLite handle and Postgres client is always closed, and every
    logged failure is a stable safe category (e.g. `sqlite_unavailable`,
    `installation_mismatch`) - never a path, UUID, connection string, or
    certificate content.
  - When the flag is unset (the default for local dev, CI, and tests),
    `scripts/start-standalone.js` behaves exactly as before: verification
    is skipped without touching SQLite or Postgres.
- **Readiness**: `GET /api/ready` additively reports
  `checks.installation`: `"not_required"` when the flag is off (never
  affecting overall `ok`), `"ok"` when both markers match, `"error"`
  (overall `503`) for any marker failure. `GET /api/health` is unchanged.

**Safe rollout sequence** (do not skip or reorder):

1. Confirm the current `founder-os.db` on the Railway volume, and take an
   off-volume backup of it first (`npm run backup:sqlite`, then download it
   per the "Downloading a backup off the volume" section above) - this
   installation marker is new state, and you want a known-good copy of the
   database from before it existed.
2. Deploy this code with `FOUNDER_OS_VERIFY_INSTALLATION` still unset - a
   no-op deploy for production behavior, same as Phase 1's rollout.
3. Apply migration `0009_sqlite_installations.sql` explicitly
   (`npm run db:migrate` against production `DATABASE_URL`).
4. Run `npm run register:installation -- --sqlite-path /app/data/founder-os.db`
   once, by hand, against the production volume and `DATABASE_URL`.
5. Verify both markers exist and match without ever printing their values -
   confirm the registration CLI reported success (it never prints the
   UUID), and confirm `GET /api/ready` still reports
   `checks.installation: "not_required"` at this point (the flag is still
   off).
6. Enable `FOUNDER_OS_VERIFY_INSTALLATION=true` as a Railway service
   variable, alongside the already-enabled `FOUNDER_OS_REQUIRE_EXISTING_DB=true`.
7. Redeploy, then confirm the deployment actually came up and
   `GET /api/ready` reports `checks.installation: "ok"` and `ok: true`.

**Rollback**: disable only `FOUNDER_OS_VERIFY_INSTALLATION` (unset it, or
set it to anything other than exactly `"true"`) and redeploy. This never
touches either marker - both stay registered exactly as they were - it only
stops the startup check and the readiness check from consulting them.
`FOUNDER_OS_REQUIRE_EXISTING_DB` can stay enabled; only the new flag needs
to come back off.

**Recovering from a genuinely restored backup**: restoring a verified
snapshot per the "Restoring a snapshot" steps above brings back that
snapshot's own installation marker along with the rest of its data, so a
correctly restored `founder-os.db` still matches the Postgres marker and
verification passes normally. A **pre-marker backup** (taken before this
feature existed, or before registration ever ran) has no
`installation_metadata` row at all - restoring one of those requires
explicit inspection and manual reconciliation before re-enabling
verification: either re-run the registration CLI against the restored file
(only valid in the "SQLite exists, Postgres absent" state - if Postgres
still has a marker from before the restore, registration will correctly
hard-fail on a mismatch, which is a signal to investigate, not to force
past) or restore Postgres's marker table alongside the SQLite file from a
consistent point in time.

**What this does not detect**: a matching installation marker only proves
the current founder-os.db is the same *installation* it always was - it
says nothing about whether a given restored backup is the *newest*
available one. Restoring an old-but-legitimate snapshot of the same
installation still passes verification even if a newer snapshot existed;
choosing the right backup to restore remains a human judgment call made
before running the restore steps above, not something this marker checks.

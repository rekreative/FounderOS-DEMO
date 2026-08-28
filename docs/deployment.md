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
  pings Postgres via the same `SELECT 1` primitive `lib/server/ops-status.ts`
  uses (`{ ok: true }` HTTP 200 when reachable, `{ ok: false }` HTTP 503
  otherwise, no raw error detail in the body). Useful for diagnostics and
  external monitoring, but **not** consulted by Railway to decide whether
  to keep the process alive.

Both are exact-match public routes — see `middleware.ts`'s
`PUBLIC_STATUS_PATHS` exception, which lets them bypass the optional legacy
`FOUNDER_OS_ACCESS_TOKEN` gate and the Supabase session check.

## Manual SQLite backups

Railway's native volume backups are **not** purchased for this project.
`data/founder-os.db`, `data/bank.db`, and `data/ledger.db` are backed up
**manually**, by a human running one command. There is no scheduler, no API
route, and nothing runs this automatically on boot or deploy. See
`lib/backup.ts` and `scripts/backup-sqlite.ts`.

### Running a backup

```
npm run backup:sqlite
```

What it does, in order:

1. **Preflight**: opens all three source databases read-only
   (`fileMustExist: true`, so a missing file throws instead of silently
   creating an empty replacement, and a forced first-page read catches a
   corrupt/non-SQLite file too). If **any** of the three is missing or
   unreadable, the run aborts immediately with a non-zero exit and creates
   **no** files at all, never a partial or misleading backup set.
2. **Collision check**: if a snapshot or manifest filename for the run id
   about to be used already exists on disk, the run aborts immediately and
   creates no files. A backup never overwrites a previous set.
3. **Snapshot**: for each source, calls `better-sqlite3`'s
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
5. **Manifest**: writes one `data/backups/manifest-<timestamp>.json`
   recording, per database: source name, source path, snapshot filename,
   byte size, timestamp, SHA-256, and integrity result (or the error, for a
   source that failed verification). The founder-os.db entry additionally
   records row counts for `agent_messages`, `agent_runs`, and `broadcasts`,
   the tables flagged as unbounded-growth risks, so growth is visible in
   every run without needing a separate query.
6. **Retention**: only when **all three** snapshots pass verification, keeps
   the latest 3 successful backup sets under `data/backups/` and deletes the
   snapshot and manifest files of any older successful sets. A manifest is
   only trusted for retention if it is structurally exact: its own filename
   matches its declared run id, it lists exactly one entry per required
   source with no duplicates and no unexpected sources, and every entry
   filename equals exactly what that source and run id would produce, with
   no path separators of any kind. Deletion additionally only ever unlinks a
   path whose resolved parent directory is exactly the resolved backups
   directory, so a source `.db`, a `-wal`/`-shm` sidecar, a file outside
   `data/backups/`, or any manifest that fails validation is never a
   deletion candidate. A run that fails verification skips retention
   entirely, so failed-run evidence is never auto-deleted.

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

### Known gap: missing-database detection (deferred)

`getDb()` (`lib/data.ts`) cannot currently distinguish "this is a genuinely
new environment's first boot" from "the production volume was lost and
recreated"; both look identical from inside the app, an empty database that
gets auto-seeded. A marker row stored inside `founder-os.db` itself was
considered and rejected: it disappears with the exact volume loss it would
need to detect, so it cannot prove anything. No fix was found that is
unambiguous without external state outside the SQLite volume. The
recommended follow-up (not implemented here, requires its own explicit
scope): record a small "last known SQLite install id / last-backup-seen"
signal in Postgres, which is already durable and independent of the Railway
volume, and compare against it at boot. That is a schema change and a
product decision on its own, deliberately out of scope for this pass.

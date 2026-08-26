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
  connection string with `sslmode=require` — see `.env.example` for the
  exact shape. `lib/server/db.ts` issues no named prepared statements, so
  transaction-mode pgbouncer is also safe if ever needed.
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

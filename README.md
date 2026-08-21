# REKREATIVE OS

**The internal command center / operating system for REKREATIVE** — one
screen for the agency's own operations: clients, leads, Meta Ads, content,
automations, AI agents, integrations, results, finances, and institutional
knowledge.

This is the **Internal MVP V1**. It is not a SaaS product and isn't built to
be sold or white-labeled — it's the tool the agency uses to run itself. It
runs on the FounderOS platform, an earlier personal command-center project;
the FounderOS internal agent runtime, connectors, and knowledge tooling are
still used under the hood, but REKREATIVE's own client-facing modules are
the primary surface.

---

## Quick start

Requires **Node 18+**.

```bash
npm install
cp .env.example .env.local   # optional; only needed to wire live integrations
npm run dev                  # http://localhost:4100
```

The FounderOS-heritage side of the app (a local SQLite database) is seeded
with demo data on first run. Navigate with the sidebar or the Command
Palette (Cmd/Ctrl + K, or digit keys 1–9 for the primary REKREATIVE routes).

```bash
npm run build && npm start   # production build
npm test                     # vitest suite
npm run typecheck            # tsc --noEmit
npm run seed                 # re-seed the FounderOS-heritage SQLite DB (idempotent)
```

`npm run seed` only reseeds the legacy SQLite-backed tables (agents,
connections, roadmap). It does **not** touch REKREATIVE's own client data —
see **Architecture** below.

---

## Main routes

| Route | What it is |
| --- | --- |
| `/` | REKREATIVE OS home: executive KPI row, what needs attention, client snapshot, quick access |
| `/clients` | Client roster → each client's own workspace (Meta Ads, Leads, Automatizaciones, Agentes IA, Integraciones, Contenido, Conocimiento, Resultados, Notas) |
| `/leads` | CRM leads pipeline (distinct from Meta-platform-attributed leads) |
| `/meta-ads` | Meta Ads campaigns, spend, CPL/CPC/CTR |
| `/automations` | Automation roster — lifecycle status and run health tracked separately |
| `/ai-agents` | AI agent configuration roster (configuration completeness, not live execution) |
| `/connections` | Per-client integration requirements and connection status |
| `/results` | CRM funnel, attributed revenue, ROAS/CAC (client-attributed) |
| `/content` | REKREATIVE-internal content production pipeline |
| `/finances` | REKREATIVE-level processor income/expenses (agency-wide, distinct from `/results`) |
| `/brain` | Structured institutional knowledge (decisions, learnings, SOPs, client context) |
| `/analytics` | Portfolio-wide benchmarks across all clients |

A handful of FounderOS-heritage internal screens (`/agents`, `/integrations`,
`/org`, `/brain/legacy`, and others) still exist in the codebase for internal
reference but are intentionally not part of REKREATIVE's primary navigation,
command palette, or digit shortcuts.

---

## Architecture

REKREATIVE's own operational modules — Clients, Leads, Meta Ads,
Automations, AI Agents, Connections, Results, Content, and the Knowledge
board — are **Internal MVP V1**: each stores its data in the browser's
`localStorage`, seeded with realistic demo data on first load. This keeps
V1 fast to build and fully functional client-side, but it means:

- data lives per browser profile — a different browser or a cleared profile
  resets to the seeded demo clients;
- there is no cross-device sync, and no server-side validation boundary on
  this data yet.

**Centralizing this onto a real backend (database + API layer) is future
work**, not something this build claims to already have.

The FounderOS-heritage side of the app — the internal agent runtime,
connector status board, and knowledge/brain tooling — keeps its original,
more mature architecture:

- **`lib/data.ts`** / **`lib/db.ts`**: `getDb()` singleton over a seeded
  SQLite store, with typed repositories.
- **`lib/schemas.ts`**: Zod schemas validate every row on the way out of the DB.
- **`lib/connectors/*`**: connector groups, each returning an honest
  `ConnectorStatus` — never a fake "connected".
- **`lib/agents/*`**: the FounderOS agent registry, each with a real `run()`.

New data on the FounderOS-heritage side still means a new repo method, a Zod
schema, a seed entry, and a test. REKREATIVE's own modules follow the
equivalent discipline in `lib/*.ts` (typed models, derived-not-persisted
KPIs, honest empty states) without the SQLite/API layer, for now.

---

## Project structure

```
app/                 Next.js App Router; one folder per view plus /api routes
components/          UI: REKREATIVE boards/panels, dashboard sections, terminal primitives
lib/
  clients.ts, leads.ts, meta-ads.ts, automations.ts, agents-ai.ts,
  integration-connections.ts, results.ts, content-items.ts,
  knowledge-entries.ts   REKREATIVE's own modules (localStorage-backed, V1)
  data.ts, db.ts       FounderOS-heritage repository layer plus app DB singleton
  seed.ts              FounderOS-heritage seeded content
  schemas.ts           Zod schemas (validate every DB/API boundary)
  connectors/           FounderOS-heritage honest-status integrations
  agents/               FounderOS-heritage agent registry plus runtimes
scripts/             seed plus doc-generation scripts
tests/               vitest suite (one file per module)
```

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to
`.env.local` and fill in only what you want to wire up; everything else
stays in honest "not configured" mode. `.env.local` is gitignored.

**Never commit real keys.**

---

## Tech stack

- **Next.js 14** (App Router, server components) plus **TypeScript**
- **Tailwind CSS**: monochrome "Monolith Signal" theme, color means status only
- **better-sqlite3**: seeded local store for the FounderOS-heritage side (WAL)
- **Zod**: schema validation at every FounderOS-heritage boundary
- **Vitest**: test suite

---

## Testing

```bash
npm test          # run the full vitest suite
npm run typecheck # tsc --noEmit
```

Tests live in `tests/`, one file per module.

---

## Note on the demo data

All names, companies, clients, financial figures, and social numbers are
**placeholder data**. Nothing here is real.

## License

MIT. See [`LICENSE`](LICENSE).

# SLAW Botfather

Self-hosted **control tower** for a fleet of [SLAW](../slaw) instances. Gives an
enterprise admin fleet-wide visibility — every machine, instance, squad, the
issues agents are working, and the tokens/cost they burn — while each SLAW
instance stays fully local and sovereign.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design and
[`BUILD-PLAN.md`](./BUILD-PLAN.md) for the phased plan.

## Monorepo layout

```
packages/protocol   @slaw/botfather-protocol — the instance⇄tower wire contract (Zod, protocol v1)
packages/db         @slaw-botfather/db — Drizzle schema + migrations (Postgres)
server              Express ingest + admin API, alert engine, rollups, reconciliation, live WS
ui                  React + Vite dashboard (dark default, light toggle), wired to /api/admin/*
wireframes          static HTML design reference for the 9 screens
```

## What's built (B0–B4)

- **Ingest API** `/api/ingest/v1/*` — token-less `enroll` + approval `enroll/poll`,
  `heartbeat`, `sync` (at-least-once + dedupe), `manifest` (reconciliation), and a
  `live` WebSocket drill-down channel.
- **Auth** — per-instance API keys (argon2-hashed, sha256-fingerprint lookup);
  admin approval queue + auto-approve rules; revocation.
- **Admin API** `/api/admin/*` — approval queue, auto-approve rules, fleet,
  instance detail, issues-in-flight, cost analytics (rollups, forecast, top
  burners), alerts (list/ack).
- **Background jobs** — status sweeper (offline/stale), hourly rollups, alert
  evaluator (budget breach, offline, stale, spend spike, version drift),
  daily retention.
- **UI** — Fleet, Instance, Cost Analytics, Issues, Alerts, Approvals & Admin.

## Dev

```bash
pnpm install
pnpm --filter @slaw/botfather-protocol build   # protocol + db must build first
pnpm --filter @slaw-botfather/db build
# point at a Postgres on :54330 (or set BOTFATHER_DATABASE_URL), then run migrations:
pnpm --filter @slaw-botfather/db exec drizzle-kit migrate
pnpm --filter @slaw-botfather/server dev       # :8400
pnpm --filter @slaw-botfather/ui dev           # :5174 (proxies /api → :8400)
```

Tests use an in-process Postgres (pglite), so they run without a database:

```bash
pnpm --filter @slaw-botfather/server test
```

> Note: production uses node-postgres against your embedded Postgres. The
> sandbox/test path uses pglite only.

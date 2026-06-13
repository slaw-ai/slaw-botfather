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

## Security: bind & admin auth

The tower binds to **loopback (`127.0.0.1`) by default** — a fresh install is
never reachable off-box. Front it with a reverse proxy (which terminates TLS)
and the proxy talks to the tower over loopback.

To expose the tower on a network interface you must widen the bind **and**
configure an admin token; the server refuses to start exposed-and-unauthenticated:

```bash
# generate a strong shared admin secret
export BOTFATHER_ADMIN_TOKEN="$(openssl rand -hex 32)"
# widen the bind only when fronted by a proxy that terminates TLS
export BOTFATHER_BIND=0.0.0.0
pnpm --filter @slaw-botfather/server dev
```

The admin UI / API authenticates with `Authorization: Bearer $BOTFATHER_ADMIN_TOKEN`.
Behaviour of `/api/admin`:

| Bind | `BOTFATHER_ADMIN_TOKEN` | `/api/admin` |
|------|-------------------------|--------------|
| `127.0.0.1` (default) | unset | open (local dev convenience) |
| `127.0.0.1` | set | requires the bearer token |
| `0.0.0.0` / any non-loopback | unset | **server refuses to start** |
| `0.0.0.0` / any non-loopback | set | requires the bearer token |

Store the token in a session/login screen, not in source or `localStorage`.
This shared-secret gate is the pre-SSO v1; the middleware is a single function
so SSO (EntraID) can later swap the body without touching route wiring.

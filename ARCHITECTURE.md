# SLAW Botfather — Architecture

_Control tower for a fleet of SLAW instances. v0.1 design — 2026-06-06._

## 1. Vision & principles

SLAW runs locally on each person's desktop (engineer, tester, cyber analyst), with no cloud infrastructure beyond the inference provider. **Botfather** is the one piece of shared infrastructure an enterprise deploys: a single self-hosted service that gives admins fleet-wide visibility — every instance, every squad, the issues agents are working, and the tokens/cost they burn.

Design principles, in priority order:

1. **Instances stay sovereign.** A SLAW instance must remain fully functional when botfather is unreachable. Botfather is observability + governance, never a runtime dependency.
2. **Push, not pull.** Instances initiate all connections outbound over HTTPS. No inbound ports on desktops, works behind NAT/VPN/proxies, nothing for endpoint security to flag.
3. **Metadata and metrics, not content.** Botfather receives names, statuses, counts, and costs — not issue bodies, comments, code, diffs, or run logs. Work content stays on the desktop.
4. **Identity without auth (for now).** SLAW has no user auth yet, so botfather keys everything on `machineId` + `instanceId` + squad names. The schema reserves a `userPrincipal` column so EntraID can slot in later without remodelling.
5. **One binary, one Postgres.** Botfather reuses the SLAW stack (Node + React + Postgres, pnpm monorepo) so it feels like SLAW and can share packages.

```
┌─ Desktop A ────────────┐
│ SLAW instance          │──┐
│  └ reporter (sidecar   │  │  HTTPS push (batches)
│     module in server)  │  │  + optional WS (live)
└────────────────────────┘  │
┌─ Desktop B ────────────┐  ▼
│ SLAW instance          │──►  ┌──────────────────────────────┐
└────────────────────────┘     │  BOTFATHER (self-hosted)     │
┌─ Desktop C ────────────┐     │  ingest API ─► Postgres      │
│ SLAW instance ×2       │──►  │  admin UI (fleet dashboard)  │
│  (two instanceIds)     │     │  enrollment / revocation     │
└────────────────────────┘     └──────────────────────────────┘
```

## 2. Components

### 2.1 Instance side: the Reporter

A new module inside the existing SLAW server (`server/src/services/botfather-reporter.ts` + `server/src/services/botfather-client.ts`). **Not** a separate process — it rides the server lifecycle, reuses its DB connection, and follows two patterns already in the codebase:

- **Outbound HTTP**: mirror `feedback-share-client.ts` (native `fetch`, Bearer token, gzip+JSON payloads, retry with backoff).
- **Scheduling**: an interval timer like the heartbeat scheduler (`heartbeatSchedulerIntervalMs`, default 30s); reporter default 60s, configurable.

Responsibilities: enroll once, send heartbeats, batch deltas, spool when offline (§5), and never block or crash the host server (all failures are logged and swallowed).

### 2.2 Botfather server

New repo `slaw-botfather` (pnpm monorepo mirroring SLAW's layout: `server/`, `ui/`, `packages/db`, `packages/shared`). Subsystems:

- **Ingest API** — versioned endpoints under `/api/ingest/v1/*`, validating payloads (Zod schemas shared via a published `@slaw/botfather-protocol` package consumed by both repos).
- **Fleet registry** — instances, their machines, enrollment state, last-seen, health.
- **Metrics store** — append-only cost/usage facts + periodic rollups.
- **Admin UI** — React dashboard (§7).
- **Enrollment service** — token mint/exchange/revoke (§6).

### 2.3 Shared protocol package

`@slaw/botfather-protocol`: TypeScript types + Zod schemas for every payload, plus the protocol version constant. Single source of truth so instance and tower can't drift. Versioned envelope on every request:

```jsonc
{
  "protocolVersion": 1,
  "instance": { "machineId": "…", "instanceId": "default", "slawVersion": "0.4.2" },
  "sentAt": "2026-06-06T03:21:00Z",
  "messages": [ /* typed events, see §4 */ ]
}
```

Botfather accepts version N and N−1; older instances get a `426 Upgrade Required` with a human-readable reason that surfaces in the instance's log and UI.

## 3. Identity

Until EntraID lands, the identity tuple is **(machineId, instanceId)**:

- **`machineId`** — new concept. Stable hardware-ish ID derived at first run: prefer OS machine GUID (`/etc/machine-id`, macOS `IOPlatformUUID`, Windows `MachineGuid`), hashed with a static app salt → UUID-shaped string. Stored in `~/.slaw/machine.json` (per-machine, NOT per-instance) so all instances on one box share it. Hostname is also captured (display only — hostnames change).
- **`instanceId`** — already exists: `resolveSlawInstanceId()` in `packages/shared/src/home-paths.ts` (`SLAW_INSTANCE_ID` env, default `"default"`). Multiple instances per machine are expected and rendered as children of the machine in the UI.
- **`installId`** — the existing anonymous telemetry UUID stays separate; botfather does not reuse it (different consent context).
- **Squads/agents/issues** — reported with their local UUIDs + names. Local UUIDs are unique per instance DB, so botfather keys child entities as `(machineId, instanceId, localId)`.
- **Future `userPrincipal`** — nullable column on `instances` from day one. When EntraID arrives, the enrollment exchange will carry an Entra token; botfather fills the column and the UI starts grouping by person. No migration needed.

## 4. Reporting & sync protocol

All instance→botfather traffic uses four endpoints. JSON, gzipped; enroll/poll are unauthenticated, heartbeat/sync are Bearer-authenticated (§6).

### 4.1 `POST /api/ingest/v1/enroll` + `/enroll/poll` — startup, no token

`enroll` body: instance identity (machineId, instanceId, hostname, os, slawVersion) + capabilities. **No token.** Response: `{ enrollmentId, state: "pending", pollIntervalSec }` — and if an auto-approve rule matches, state may be `active` with the `apiKey` returned immediately.

`enroll/poll` body: `{ enrollmentId }`. Response: current state; on `active` it returns the per-instance `apiKey` (stored in the instance's secrets store, not plaintext config); on `rejected` the instance stops polling. Re-enrollment with the same (machineId, instanceId) rotates the key. See §6 for the full lifecycle and the startup gate.

### 4.2 `POST /api/ingest/v1/heartbeat` — every 60s (configurable)

Lightweight liveness + snapshot summary:

```jsonc
{
  "status": "ok",
  "uptimeSec": 86400,
  "counts": { "squads": 2, "agents": 7, "activeRuns": 3, "openIssues": 12 },
  "spend": { "todayCents": 412, "monthCents": 6240 },
  "lastEventCursor": "01HV…"   // high-water mark, lets botfather detect gaps
}
```

Botfather marks an instance `offline` after 3 missed heartbeats, `stale` after 24h. This is also the **policy back-channel**: the heartbeat *response* can carry directives (e.g. "raise sync interval", "config updated", later possibly budget policies) — keeping the push-only model while allowing tower→instance signalling without inbound connections.

### 4.3 `POST /api/ingest/v1/sync` — every 60s, only when there are deltas

The workhorse. Two message families in one batch:

**a) Entity upserts (state sync).** Snapshot-style records for squads, agents, projects, and issues — *metadata only*:

| Entity | Fields reported |
|---|---|
| squad | localId, name, status, budgetMonthlyCents, spentMonthlyCents |
| agent | localId, squadLocalId, name, role, status, adapterType, budget/spent cents |
| project | localId, squadLocalId, name, status |
| issue | localId, squadLocalId, projectLocalId, title, status, assigneeAgentLocalId, updatedAt |

Issue **titles** are included (admins need to see *what* is being worked); descriptions/comments are not. A config flag `botfather.reportIssueTitles: boolean` (default true) lets privacy-sensitive deployments send only issue IDs + statuses.

**b) Fact events (append-only).** Sourced from tables that already exist in SLAW:

- **`cost_event`** — direct projection of the `cost_events` table (`packages/db/src/schema/cost_events.ts`): localId, squad/agent/issue/project localIds, provider, biller, billingType, model, inputTokens, cachedInputTokens, outputTokens, costCents, occurredAt. This is the atom of all cost/token reporting — botfather aggregates, never the instance.
- **`run_event`** — projection of `heartbeat_runs` status transitions: runLocalId, agentLocalId, status, startedAt/finishedAt, token totals from `usageJson`. No logs, no `resultJson`.
- **`activity_event`** — a *whitelisted subset* of `activity_log` actions (lifecycle + governance only: `agent.created`, `budget_soft_threshold_crossed`, `budget_hard_threshold_crossed`, `cost.reported`…). The `details` JSON is filtered through a per-action allowlist before sending.

**Delta detection** uses a cursor table on the instance (`botfather_sync_state`: per-entity last-synced `updatedAt`/max id). Fact events are read strictly above the last acknowledged cursor; entity upserts are sent when `updatedAt` exceeds the cursor. The sync response acknowledges the batch with the new cursor — the instance only advances its cursor on ack, giving **at-least-once delivery**; botfather deduplicates facts on `(machineId, instanceId, localId)` for **effective exactly-once**.

### 4.4 Optional live channel (phase 2)

For the drill-down view, a polling gap of 60s is fine for cost, but "what is this agent doing right now" wants seconds. Phase 2: instance opens an **outbound WebSocket** to `wss://botfather/api/ingest/v1/live` (reusing SLAW's `ws` patterns from `realtime/live-events-ws.ts`) and streams the same fact events in real time *only while an admin has that instance's drill-down open* — botfather requests the stream via the heartbeat back-channel. Keeps idle overhead near zero.

### 4.5 Full reconciliation

Nightly (and on demand via heartbeat directive), the instance sends a **manifest**: counts + checksums per entity type. If botfather's view disagrees, it requests a full snapshot for the divergent entity types. Heals any drift from missed batches or botfather restores.

## 5. Offline behaviour & spooling

- Reporter keeps an on-disk spool at `~/.slaw/instances/{id}/botfather/spool/` (NDJSON segments, capped — default 50 MB / 14 days, oldest dropped first with a warning).
- Send failures → exponential backoff (1m → 2m → … → 30m cap) with jitter; heartbeats keep trying on their own cheaper cadence.
- Because cost facts live in the instance's own `cost_events` table anyway, even a dropped spool is recoverable via reconciliation (§4.5) — the spool is an optimization, the DB is the source of truth.
- Botfather down for a day → instances batch up and drain when it returns; ingest endpoint applies per-instance rate limits to absorb thundering herds.

## 6. Discovery, auto-enrollment & the startup gate

**Decided 2026-06-06 — replaces the earlier enrollment-token design.** The enterprise posture is **mandatory by default**: if a botfather is reachable for this instance, the instance must be enrolled and admitted before its UI is usable. Auto-enrollment removes per-user friction; an admin approval queue preserves admission control without handing tokens to end users.

### 6.1 Discovery — pre-provisioned config

IT ships the botfather URL to each machine via standard channels (config file, env var, MDM profile, golden image, setup script) — see §8. On startup the instance reads `botfather.url`:

- **URL present** → botfather is "expected"; the startup gate (§6.3) engages.
- **URL absent/empty** → standalone instance, no gate, no reporter. A SLAW instance on a personal laptop with no corp config behaves exactly as today.

DNS-based discovery is deliberately out of scope for v1 — config is deterministic and matches enterprise provisioning practice.

### 6.2 Auto-enrollment + approval queue (pre-EntraID)

No end-user tokens. On first start with a botfather URL, the instance **self-enrolls**:

1. Instance `POST /api/ingest/v1/enroll` with its identity (`machineId`, `instanceId`, hostname, os, slawVersion). **No token.** Botfather returns a provisional `enrollmentId` + poll interval, valid only for polling its own enrollment state.
2. Botfather creates the instance record in state **`pending`**. No API key is issued yet, so no facts can flow.
3. The instance appears in botfather's **Approval Queue** (admin UI). An admin **approves** or **rejects** it. Bulk-approve and auto-approve rules (e.g. "any machine matching `*-ENG-*`") prevent this becoming a bottleneck.
4. Instance polls `POST /api/ingest/v1/enroll/poll` with its `enrollmentId`; once approved, botfather returns the unique **per-instance API key**.
5. Key stored via SLAW's existing secrets provider; all subsequent calls use `Authorization: Bearer`. State → `active`.

Network reachability + admin approval = trust for this phase. Rejection puts the instance in `rejected`; it shows that in the gate and stops polling until the user retries or config changes.

### 6.3 The startup gate (instance UI)

When a botfather URL is configured, the SLAW UI renders a **blocking enrollment gate** ahead of the normal app — the user cannot reach squads/agents until the instance is `active`. The gate mirrors enrollment status:

| State | Gate shows | App access |
|---|---|---|
| `connecting` | "Contacting control tower at `botfather.corp`…" | blocked |
| `pending` | "Awaiting admin approval. Registered as `MEL-ENG-12`." + live poll spinner | blocked |
| `rejected` | "Enrollment declined. Contact your administrator." + retry | blocked |
| `active` | brief "Enrolled ✓" → app loads | **unblocked** |
| `unreachable` | see §6.4 | per fail-mode policy |
| `revoked` | "Access revoked by administrator. Re-enrolling…" (auto re-enroll → `pending`) | blocked |

This is the "force a botfather connection and auto-enrollment through the UI" behaviour: it's the **first thing** the instance does, and it's a hard gate.

### 6.4 Fail-open vs fail-closed when botfather is unreachable

A reachable-but-unenrolled instance is gated. But if the configured botfather is *down* at startup, behaviour is controlled by `botfather.enforcement`:

- **`enforce` (default, hard gate):** a never-enrolled instance stays gated and keeps retrying — no tower, no app. An **already-enrolled** instance with a valid cached API key is allowed to run (fail-open *for the enrolled*), keeps spooling, and reconnects per §5. Enterprise default: new machines can't bypass the tower by yanking the network, but working machines aren't held hostage by tower downtime.
- **`advisory` (soft gate):** the gate is dismissible; the instance runs and reports best-effort. For pilots / low-control environments.

`enforcement` is an instance config value, set by the same IT provisioning that sets the URL — if the config is delivered read-only (MDM), an end user can't downgrade their own gate. Post-v1, botfather can also assert enforcement centrally via a heartbeat directive.

### 6.5 Manageable anytime — SLAW settings

Enrollment is **not** a one-shot wizard; it lives permanently in **SLAW Settings → Control Tower**, reflecting and editing the same config the gate uses:

- Botfather URL (if not locked by provisioning), connection + enrollment status, last sync, spool depth.
- Actions: re-enroll, disconnect (where policy permits), copy `machineId`, view what's being reported (transparency).
- If provisioning locks these fields, settings shows them greyed with a "managed by your organisation" note.

The gate handles first-run; Settings handles every day after.

### 6.6 Security properties & EntraID path

Per-instance revocation (admin revokes → key dies → instance 401s → auto re-enroll back into the `pending` queue). No shared secrets; keys hashed (argon2) on botfather; key rotation on re-enroll. TLS mandatory; botfather behind the corp's standard reverse proxy/cert.

**EntraID upgrade path:** the approval queue is replaced or augmented by Entra device/user identity — enrollment exchange accepts an Entra token, auto-admission keys off Entra group membership, `userPrincipal` is populated, and admin UI auth moves to Entra SSO. Protocol and schema unchanged.

**Threat notes:** a malicious instance can only lie about itself (facts namespaced to its key); a `pending`/`rejected` instance has no key and can write nothing; ingest validates payload size and shape; back-channel directives are a typed enum and never execute code on the instance.

## 7. Botfather data model & UI

### 7.1 Core tables

```
machines        (id, machineId UNIQUE, hostname, os, firstSeen, lastSeen)
instances       (id, machineFk, instanceId, slawVersion, status[ok|offline|stale|revoked],
                 apiKeyHash, userPrincipal NULL, enrolledAt, lastHeartbeatAt)
squads          (id, instanceFk, localId, name, status, budgetCents, spentCents, updatedAt)
agents          (id, instanceFk, squadFk, localId, name, role, status, adapterType, …)
projects        (id, instanceFk, squadFk, localId, name, status, updatedAt)
issues          (id, instanceFk, squadFk, projectFk NULL, localId, title, status,
                 assigneeAgentFk NULL, updatedAt)
cost_facts      (id, instanceFk, squadFk, agentFk, issueFk NULL, localId,
                 provider, billingType, model, inputTokens, cachedInputTokens,
                 outputTokens, costCents, occurredAt)        -- append-only
run_facts       (id, instanceFk, agentFk, localId, status, startedAt, finishedAt, tokenTotals)
activity_facts  (id, instanceFk, action, entityRef, detailsFiltered, occurredAt)
rollups_daily   (day, instanceFk NULL, squadFk NULL, agentFk NULL, model NULL,
                 inputTokens, outputTokens, costCents)       -- materialized hourly
enrollments     (id, enrollmentId UNIQUE, machineId, instanceId, hostname, os, slawVersion,
                 state[pending|active|rejected|revoked], apiKeyHash NULL, requestedAt,
                 decidedAt NULL, decidedBy NULL, matchedRule NULL)   -- approval queue + history
auto_approve_rules (id, pattern, field[hostname|machineId], enabled, createdBy, createdAt)
```

The `instances` table's `status` enum gains `pending`/`rejected` to match the enrollment lifecycle; an instance only becomes a full `instances` row (with `apiKeyHash`) on approval, while `enrollments` holds the queue + audit trail. The old `enrollment_tokens` table is dropped — no end-user tokens in this design.

`rollups_daily` powers all dashboard charts; raw `cost_facts` retained 13 months (configurable), rollups indefinitely.

### 7.2 Admin UI views

- **Fleet** — grid/list of machines→instances: status dot, version, squads count, today/month spend, last seen. Network-wide totals header: cost today / this month, tokens by model, active runs.
- **Instance drill-down** — squads on that instance; per-squad agents, open issues (title + status + assignee), spend sparkline.
- **Squad drill-down** — agents, issues in flight, cost by agent and by model, budget vs spend.
- **Cost analytics** — network-wide: cost/tokens over time, by model, by provider, by instance, by squad; top burners; month-over-month.
- **Issues view** — what the fleet is working on right now: live list of in-progress issues across all instances.
- **Approval Queue** — `pending` instances awaiting admission: identity, requesting machine, matched auto-approve rule (if any); approve / reject / bulk-approve; manage auto-approve rules.
- **Admin** — enrolled-instance list, revocation, auto-approve rules, stale-instance cleanup, retention settings.

## 8. Instance-side config

New `botfather` section in SLAW's config schema (`packages/shared/src/config-schema.ts`), alongside the existing `telemetry` block:

```jsonc
"botfather": {
  "url": "https://botfather.corp",   // presence of a URL = botfather expected; gate engages
  "enforcement": "enforce",          // "enforce" (hard gate, default) | "advisory" (soft)
  "locked": false,                   // true when IT delivers this read-only (MDM) — UI greys fields
  "syncIntervalSec": 60,
  "heartbeatIntervalSec": 60,
  "reportIssueTitles": true,
  "spool": { "maxMb": 50, "maxDays": 14 }
}
```

There is no `enabled` flag — **a configured `url` is what turns the integration on** (and engages the startup gate per §6.3); no URL means standalone. The API key lives in the secrets store, not here. `SLAW_BOTFATHER_URL` / `SLAW_BOTFATHER_DISABLED` env overrides follow the existing config-precedence rules (`SLAW_BOTFATHER_DISABLED` is honoured only when `enforcement` is `advisory`, or for never-enrolled instances — it cannot silently detach an enrolled enterprise machine). Enrollment state is surfaced in two places: the **startup gate** on first run (§6.3) and **Settings → Control Tower** thereafter (§6.5) — so users always know their instance reports to a tower.

## 9. Build plan

| Phase | Deliverable |
|---|---|
| **B0** | Repo scaffold (mirror SLAW monorepo), `@slaw/botfather-protocol` package, DB schema + migrations, ingest API with enroll/heartbeat/sync, minimal fleet list UI |
| **B1** | Instance-side reporter in SLAW (config section, machineId, cursor table, spool, enroll CLI), end-to-end with 2 local instances |
| **B2** | Dashboard build-out: drill-downs, cost analytics, rollups, issues view |
| **B3** | Reconciliation, revocation UX, rate limiting, retention jobs |
| **B4** | Live WebSocket drill-down (phase-2 channel) |
| **B5** | EntraID: enrollment via Entra token, `userPrincipal`, SSO on admin UI |

## 10. Decided directions (2026-06-06)

1. **Budget policy push-down: YES (post-v1).** Botfather will centrally govern budgets, delivered to instances via the heartbeat back-channel directive enum. v1 stays read-only; protocol already supports it.
2. **Multi-tower / hierarchical: YES (future).** Team tower → org tower; botfather will re-publish upstream using the same ingest protocol. Not designed in detail for v1.
3. **Alerting: YES — dashboard-only first.** Budget breaches and instance-health alerts surface as an in-dashboard alerts feed (driven by `budget_*_threshold_crossed` activity facts + heartbeat status). External integrations (Teams/email) planned later.

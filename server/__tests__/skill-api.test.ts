/**
 * P2 — skill registry API smoke. Boots the real Express app on a pglite db and
 * drives it over HTTP: admin authors+publishes a skill → an enrolled instance
 * pulls the catalog + content → a heartbeat carries the `skills_updated` hint
 * until the instance echoes the catalog version.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { schema } from "@slaw-botfather/db";
import type { BotfatherDb } from "@slaw-botfather/db";
import { createApp } from "../src/app.js";
import { enroll, pollEnrollment, decideEnrollment } from "../src/services/enrollment.js";
import { PROTOCOL_VERSION } from "@slaw/botfather-protocol";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../packages/db/migrations");

let db: BotfatherDb;
let server: Server;
let base: string;
let apiKey: string;

async function applyMigrations(client: PGlite) {
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(migrationsDir, f), "utf8").split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await client.exec(s);
    }
  }
}

const config = {
  port: 0,
  databaseUrl: undefined,
  embeddedPgPort: 0,
  offlineAfterMissedHeartbeats: 3,
  heartbeatIntervalSec: 60,
  staleAfterHours: 24,
  ingestRateLimitPerMin: 1000,
};

beforeAll(async () => {
  const client = new PGlite();
  await applyMigrations(client);
  db = drizzle(client, { schema }) as unknown as BotfatherDb;
  const app = createApp(db, config);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // enroll + approve an instance to get a usable api key
  const e = await enroll(
    db,
    { machineId: "skill-api-test-1", instanceId: "default", hostname: "SKILL-1", os: "linux", slawVersion: "0.4.2" },
    true,
  );
  await decideEnrollment(db, e.enrollmentId, "approve", "admin");
  const polled = await pollEnrollment(db, e.enrollmentId);
  apiKey = polled?.apiKey ?? "";
  expect(apiKey).toBeTruthy();
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const adminJson = (path: string, init?: RequestInit) =>
  fetch(`${base}/api/admin${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
const ingest = (path: string, init?: RequestInit) =>
  fetch(`${base}/api/ingest/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });

function heartbeatBody(appliedSkillCatalogVersion?: number) {
  return JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    sentAt: new Date().toISOString(),
    status: "ok",
    uptimeSec: 1,
    counts: { squads: 0, agents: 0, activeRuns: 0, openIssues: 0 },
    spend: { todayCents: 0, monthCents: 0 },
    lastEventCursor: null,
    appliedSkillCatalogVersion,
  });
}

describe("admin skill CRUD + publish", () => {
  it("creates a draft (not served), then publishing serves it in the catalog", async () => {
    const created = await adminJson("/skills", {
      method: "POST",
      body: JSON.stringify({ key: "playwright-e2e", name: "Playwright E2E", markdown: "# run tests", category: "testing", trustLevel: "trusted" }),
    });
    expect(created.status).toBe(201);

    // draft not yet in the instance-facing catalog
    let cat = await (await ingest("/skills")).json();
    expect(cat.skills).toHaveLength(0);

    // duplicate key rejected
    const dup = await adminJson("/skills", {
      method: "POST",
      body: JSON.stringify({ key: "playwright-e2e", name: "dup" }),
    });
    expect(dup.status).toBe(409);

    // publish
    const pub = await (await adminJson("/skills/playwright-e2e/publish", { method: "POST" })).json();
    expect(pub.skill.version).toBe(1);
    expect(pub.catalogVersion).toBe(1);

    cat = await (await ingest("/skills")).json();
    expect(cat.catalogVersion).toBe(1);
    expect(cat.skills).toHaveLength(1);
    expect(cat.skills[0]).toMatchObject({ key: "playwright-e2e", name: "Playwright E2E", version: 1, trustLevel: "trusted" });
  });

  it("serves full content on the per-skill pull", async () => {
    const content = await (await ingest("/skills/playwright-e2e")).json();
    expect(content.markdown).toBe("# run tests");
    expect(content.version).toBe(1);
    // unknown key → 404
    expect((await ingest("/skills/nope")).status).toBe(404);
  });

  it("admin list reports adoption counts (0 before any instance installs)", async () => {
    const list = await (await adminJson("/skills")).json();
    expect(list.catalogVersion).toBe(1);
    const s = list.skills.find((x: any) => x.key === "playwright-e2e");
    expect(s.adoption).toEqual({ squads: 0, instances: 0 });
  });
});

describe("heartbeat skills_updated hint + version echo", () => {
  it("emits the hint while behind, then stops once the instance echoes the catalog version", async () => {
    // instance is behind (acked 0, catalog 1) → hint present
    const hb1 = await (await ingest("/heartbeat", { method: "POST", body: heartbeatBody(0) })).json();
    const hint1 = hb1.directives.find((d: any) => d.kind === "skills_updated");
    expect(hint1).toMatchObject({ kind: "skills_updated", catalogVersion: 1 });

    // instance echoes catalogVersion 1 → next heartbeat has no hint
    const hb2 = await (await ingest("/heartbeat", { method: "POST", body: heartbeatBody(1) })).json();
    expect(hb2.directives.find((d: any) => d.kind === "skills_updated")).toBeUndefined();

    // tower recorded the acked version
    const [inst] = await db.select().from(schema.instances).where(eq(schema.instances.instanceId, "default"));
    expect(inst.skillCatalogVersionAcked).toBe(1);
  });

  it("re-emits the hint after a new publish advances the catalog", async () => {
    await adminJson("/skills", { method: "POST", body: JSON.stringify({ key: "lint", name: "Lint", markdown: "x" }) });
    await adminJson("/skills/lint/publish", { method: "POST" });
    const hb = await (await ingest("/heartbeat", { method: "POST", body: heartbeatBody(1) })).json();
    const hint = hb.directives.find((d: any) => d.kind === "skills_updated");
    expect(hint).toMatchObject({ kind: "skills_updated", catalogVersion: 2 });
  });

  it("deprecate drops the skill from the catalog and is not pullable", async () => {
    await adminJson("/skills/lint/deprecate", { method: "POST" });
    const cat = await (await ingest("/skills")).json();
    expect(cat.skills.find((s: any) => s.key === "lint")).toBeUndefined();
    expect((await ingest("/skills/lint")).status).toBe(404);
  });
});

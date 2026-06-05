import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema } from "@slaw-botfather/db";
import * as tables from "@slaw-botfather/db";
import type { BotfatherDb } from "@slaw-botfather/db";
import { enroll, pollEnrollment, decideEnrollment, revokeInstance } from "../src/services/enrollment.js";
import { applySyncBatch, linkSquadFks } from "../src/services/sync.js";
import { fingerprintApiKey, verifyApiKey } from "../src/services/api-keys.js";
import { eq } from "drizzle-orm";
import {
  PROTOCOL_VERSION,
  type EnrollRequest,
  type SyncRequest,
} from "@slaw/botfather-protocol";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../packages/db/migrations");

let db: BotfatherDb;

async function applyMigrations(client: PGlite) {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = readFileSync(path.join(migrationsDir, f), "utf8");
    // drizzle splits statements on a breakpoint marker
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await client.exec(s);
    }
  }
}

beforeAll(async () => {
  const client = new PGlite();
  await applyMigrations(client);
  db = drizzle(client, { schema }) as unknown as BotfatherDb;
});

const identity = {
  machineId: "machine-aaaaaaaa-0001",
  instanceId: "default",
  hostname: "MEL-ENG-12",
  os: "darwin" as const,
  slawVersion: "0.4.2",
};

describe("B0 exit demo: enroll → pending → approve → poll key → sync → fleet", () => {
  it("self-enrolls with no token and lands pending", async () => {
    const req: EnrollRequest = {
      protocolVersion: PROTOCOL_VERSION,
      instance: identity,
      capabilities: { reportIssueTitles: true, liveStream: false },
    };
    const res = await enroll(db, req.instance, req.capabilities.reportIssueTitles);
    expect(res.state).toBe("pending");
    expect(res.apiKey).toBeUndefined();
    (globalThis as any).__enrollmentId = res.enrollmentId;
  });

  it("poll before approval returns pending, no key", async () => {
    const res = await pollEnrollment(db, (globalThis as any).__enrollmentId);
    expect(res?.state).toBe("pending");
    expect(res?.apiKey).toBeUndefined();
  });

  it("admin approves; poll then yields a usable api key once", async () => {
    const ok = await decideEnrollment(db, (globalThis as any).__enrollmentId, "approve", "admin");
    expect(ok).toBe(true);

    const first = await pollEnrollment(db, (globalThis as any).__enrollmentId);
    expect(first?.state).toBe("active");
    expect(first?.apiKey).toBeTruthy();
    (globalThis as any).__apiKey = first!.apiKey;

    // key verifies against the stored hash + fingerprint
    const [inst] = await db.select().from(schema.instances).where(eq(schema.instances.instanceId, "default"));
    expect(inst.apiKeyFingerprint).toBe(fingerprintApiKey(first!.apiKey!));
    expect(await verifyApiKey(inst.apiKeyHash!, first!.apiKey!)).toBe(true);
    (globalThis as any).__instanceFk = inst.id;

    // second poll must not mint a new key
    const second = await pollEnrollment(db, (globalThis as any).__enrollmentId);
    expect(second?.state).toBe("active");
    expect(second?.apiKey).toBeUndefined();
  });

  it("accepts a sync batch and dedupes a replay", async () => {
    const instanceFk = (globalThis as any).__instanceFk as string;
    const batch: SyncRequest = {
      protocolVersion: PROTOCOL_VERSION,
      sentAt: new Date().toISOString(),
      batchCursor: "01HVX0000000000000000000A",
      upserts: [
        {
          type: "squad",
          localId: "sq-1",
          name: "red-team-ops",
          status: "active",
          budgetMonthlyCents: 40000,
          spentMonthlyCents: 41207,
          updatedAt: new Date().toISOString(),
        },
        {
          type: "agent",
          localId: "ag-1",
          squadLocalId: "sq-1",
          name: "recon-alpha",
          role: "squad_lead",
          status: "running",
          adapterType: "claude",
          budgetMonthlyCents: 20000,
          spentMonthlyCents: 14810,
          updatedAt: new Date().toISOString(),
        },
        {
          type: "issue",
          localId: "is-1",
          squadLocalId: "sq-1",
          projectLocalId: null,
          title: "Map external attack surface",
          status: "in_progress",
          assigneeAgentLocalId: "ag-1",
          updatedAt: new Date().toISOString(),
        },
      ],
      facts: [
        {
          type: "cost_event",
          localId: "ce-1",
          squadLocalId: "sq-1",
          agentLocalId: "ag-1",
          issueLocalId: "is-1",
          projectLocalId: null,
          provider: "anthropic",
          biller: "anthropic",
          billingType: "metered_api",
          model: "claude-opus-4-6",
          inputTokens: 1000,
          cachedInputTokens: 500,
          outputTokens: 300,
          costCents: 2480,
          occurredAt: new Date().toISOString(),
        },
      ],
    };

    const first = await applySyncBatch(db, instanceFk, batch);
    expect(first.upserts).toBe(3);
    expect(first.facts).toBe(1);
    expect(first.deduplicated).toBe(0);
    await linkSquadFks(db, instanceFk);

    // replay the same batch — facts must dedupe, no double-counting
    const replay = await applySyncBatch(db, instanceFk, batch);
    expect(replay.facts).toBe(0);
    expect(replay.deduplicated).toBe(1);

    // squad fk linked on the agent
    const [ag] = await db.select().from(schema.agents).where(eq(schema.agents.localId, "ag-1"));
    expect(ag.squadFk).toBeTruthy();
  });

  it("fleet sees one instance with the single cost fact", async () => {
    const rows = await db.select().from(schema.costFacts);
    expect(rows).toHaveLength(1);
    expect(rows[0].costCents).toBe(2480);

    const insts = await db.select().from(schema.instances);
    expect(insts).toHaveLength(1);
    expect(insts[0].status).toBe("ok");
  });

  it("revocation kills the key", async () => {
    const instanceFk = (globalThis as any).__instanceFk as string;
    const ok = await revokeInstance(db, instanceFk, "admin");
    expect(ok).toBe(true);
    const [inst] = await db.select().from(schema.instances).where(eq(schema.instances.id, instanceFk));
    expect(inst.status).toBe("revoked");
    expect(inst.apiKeyHash).toBeNull();
  });
});

describe("auto-approve rule path", () => {
  it("matching hostname rule admits immediately with a key", async () => {
    await db.insert(schema.autoApproveRules).values({
      pattern: "*-ENG-*",
      field: "hostname",
      createdBy: "admin",
    });
    const res = await enroll(
      db,
      { ...identity, machineId: "machine-bbbb-0002", instanceId: "default", hostname: "SYD-ENG-04" },
      true,
    );
    expect(res.state).toBe("active");
    expect(res.apiKey).toBeTruthy();
  });
});

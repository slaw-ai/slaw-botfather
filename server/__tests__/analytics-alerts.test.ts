import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { schema } from "@slaw-botfather/db";
import type { BotfatherDb } from "@slaw-botfather/db";
import { enroll, pollEnrollment, decideEnrollment } from "../src/services/enrollment.js";
import { applySyncBatch } from "../src/services/sync.js";
import { materializeRollups } from "../src/services/rollups.js";
import { networkSummary, costByModelMtd, topBurnerSquadsMtd } from "../src/services/analytics.js";
import { evaluateAlerts } from "../src/services/alerts.js";
import { PROTOCOL_VERSION, type SyncRequest } from "@slaw/botfather-protocol";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../packages/db/migrations");

let db: BotfatherDb;
let instanceFk: string;

async function applyMigrations(client: PGlite) {
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(path.join(migrationsDir, f), "utf8");
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

  // enroll + approve an instance
  const e = await enroll(
    db,
    { machineId: "m-1", instanceId: "default", hostname: "MEL-CYB-04", os: "darwin", slawVersion: "0.4.2" },
    true,
  );
  await decideEnrollment(db, e.enrollmentId, "approve", "admin");
  await pollEnrollment(db, e.enrollmentId);
  const [inst] = await db.select().from(schema.instances).where(eq(schema.instances.instanceId, "default"));
  instanceFk = inst.id;

  const now = new Date().toISOString();
  const batch: SyncRequest = {
    protocolVersion: PROTOCOL_VERSION,
    sentAt: now,
    batchCursor: "c1",
    upserts: [
      {
        type: "squad",
        localId: "sq-1",
        name: "red-team-ops",
        status: "active",
        budgetMonthlyCents: 40000,
        spentMonthlyCents: 41207,
        updatedAt: now,
      },
    ],
    facts: [
      {
        type: "cost_event",
        localId: "ce-1",
        squadLocalId: "sq-1",
        agentLocalId: "ag-1",
        issueLocalId: null,
        projectLocalId: null,
        provider: "anthropic",
        biller: "anthropic",
        billingType: "metered_api",
        model: "claude-opus-4-6",
        inputTokens: 1000,
        cachedInputTokens: 500,
        outputTokens: 300,
        costCents: 41207,
        occurredAt: now,
      },
      {
        type: "activity_event",
        localId: "act-1",
        squadLocalId: "sq-1",
        action: "budget_hard_threshold_crossed",
        entityRef: "sq-1",
        details: { costCents: 41207, budgetMonthlyCents: 40000 },
        occurredAt: now,
      },
    ],
  };
  await applySyncBatch(db, instanceFk, batch);
});

describe("B2a analytics", () => {
  it("materializes rollups and summarizes the network", async () => {
    await materializeRollups(db);
    const sum = await networkSummary(db);
    expect(sum.spendMtdCents).toBe(41207);
    expect(sum.spendTodayCents).toBe(41207);
    expect(sum.forecastEomCents).toBeGreaterThanOrEqual(41207);
  });

  it("breaks cost down by model", async () => {
    const byModel = await costByModelMtd(db);
    expect(byModel[0].model).toBe("claude-opus-4-6");
    expect(byModel[0].cost_cents).toBe(41207);
  });

  it("ranks top burner squads with budget context", async () => {
    const squads = await topBurnerSquadsMtd(db);
    expect(squads[0].squad_name).toBe("red-team-ops");
    expect(squads[0].budget_monthly_cents).toBe(40000);
  });
});

describe("B2b alert engine", () => {
  it("raises a critical hard-budget-breach alert from the activity fact", async () => {
    await evaluateAlerts(db);
    const active = await db.select().from(schema.alerts).where(eq(schema.alerts.status, "active"));
    const breach = active.find((a) => a.rule === "budget_hard_breach");
    expect(breach).toBeTruthy();
    expect(breach!.severity).toBe("critical");
    expect(breach!.title).toContain("red-team-ops");
  });

  it("does not duplicate the alert on re-evaluation", async () => {
    await evaluateAlerts(db);
    await evaluateAlerts(db);
    const active = await db.select().from(schema.alerts).where(eq(schema.alerts.status, "active"));
    expect(active.filter((a) => a.rule === "budget_hard_breach")).toHaveLength(1);
  });

  it("flags an offline instance and resolves it when it recovers", async () => {
    await db.update(schema.instances).set({ status: "offline" }).where(eq(schema.instances.id, instanceFk));
    await evaluateAlerts(db);
    let active = await db.select().from(schema.alerts).where(eq(schema.alerts.status, "active"));
    expect(active.some((a) => a.rule === "instance_offline")).toBe(true);

    await db.update(schema.instances).set({ status: "ok" }).where(eq(schema.instances.id, instanceFk));
    await evaluateAlerts(db);
    active = await db.select().from(schema.alerts).where(eq(schema.alerts.status, "active"));
    expect(active.some((a) => a.rule === "instance_offline")).toBe(false);
  });
});

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
import { reconcile } from "../src/services/reconciliation.js";
import { runRetention } from "../src/services/retention.js";
import { PROTOCOL_VERSION, type SyncRequest, type ManifestRequest } from "@slaw/botfather-protocol";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../packages/db/migrations");
let db: BotfatherDb;
let instanceFk: string;

async function applyMigrations(client: PGlite) {
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(migrationsDir, f), "utf8").split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await client.exec(s);
    }
  }
}

beforeAll(async () => {
  const client = new PGlite();
  await applyMigrations(client);
  db = drizzle(client, { schema }) as unknown as BotfatherDb;
  const e = await enroll(
    db,
    { machineId: "rm-1", instanceId: "default", hostname: "REC-1", os: "linux", slawVersion: "0.4.2" },
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
    batchCursor: "rc1",
    upserts: [
      { type: "squad", localId: "sq-1", name: "s", status: "active", budgetMonthlyCents: null, spentMonthlyCents: 0, updatedAt: now },
    ],
    facts: [
      {
        type: "cost_event",
        localId: "ce-1",
        squadLocalId: "sq-1",
        agentLocalId: null,
        issueLocalId: null,
        projectLocalId: null,
        provider: "anthropic",
        biller: null,
        billingType: "metered_api",
        model: "claude-opus-4-6",
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        costCents: 100,
        occurredAt: now,
      },
    ],
  };
  await applySyncBatch(db, instanceFk, batch);
});

describe("B3 reconciliation", () => {
  it("reports in-sync when counts match", async () => {
    const manifest: ManifestRequest = {
      protocolVersion: PROTOCOL_VERSION,
      sentAt: new Date().toISOString(),
      counts: { squads: 1, agents: 0, projects: 0, issues: 0, costEvents: 1 },
    };
    const r = await reconcile(db, instanceFk, manifest);
    expect(r.inSync).toBe(true);
    expect(r.resyncTypes).toHaveLength(0);
  });

  it("flags divergent entity types for resync", async () => {
    const manifest: ManifestRequest = {
      protocolVersion: PROTOCOL_VERSION,
      sentAt: new Date().toISOString(),
      counts: { squads: 3, agents: 0, projects: 0, issues: 2, costEvents: 1 },
    };
    const r = await reconcile(db, instanceFk, manifest);
    expect(r.inSync).toBe(false);
    expect(r.resyncTypes).toContain("squad");
    expect(r.resyncTypes).toContain("issue");
    expect(r.resyncTypes).not.toContain("cost_event");
  });
});

describe("B3 retention", () => {
  it("prunes cost facts older than 13 months but keeps recent", async () => {
    // insert an ancient fact directly
    await db.execute(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("drizzle-orm")).sql`
        INSERT INTO cost_facts (instance_fk, local_id, squad_local_id, provider, billing_type, model,
          input_tokens, cached_input_tokens, output_tokens, cost_cents, occurred_at)
        VALUES (${instanceFk}, 'old-1', 'sq-1', 'anthropic', 'metered_api', 'claude-opus-4-6',
          1, 0, 1, 50, now() - interval '14 months')
      `,
    );
    let all = await db.select().from(schema.costFacts);
    expect(all.length).toBe(2);
    await runRetention(db);
    all = await db.select().from(schema.costFacts);
    expect(all.length).toBe(1);
    expect(all[0].localId).toBe("ce-1");
  });
});

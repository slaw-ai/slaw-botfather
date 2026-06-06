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
import { applySyncBatch, linkSquadFks } from "../src/services/sync.js";
import { PROTOCOL_VERSION, type SyncRequest } from "@slaw/botfather-protocol";

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
    { machineId: "agent-test-1", instanceId: "default", hostname: "AG-1", os: "linux", slawVersion: "0.4.2" },
    true,
  );
  await decideEnrollment(db, e.enrollmentId, "approve", "admin");
  await pollEnrollment(db, e.enrollmentId);
  const [inst] = await db.select().from(schema.instances).where(eq(schema.instances.instanceId, "default"));
  instanceFk = inst.id;
});

describe("agent metadata + squad skills sync", () => {
  const now = new Date().toISOString();

  it("applies agent metadata (title, capabilities, reportsTo) and squad_skill upserts", async () => {
    const batch: SyncRequest = {
      protocolVersion: PROTOCOL_VERSION,
      sentAt: now,
      batchCursor: "ag1",
      upserts: [
        { type: "squad", localId: "sq-1", name: "Platform", status: "active", budgetMonthlyCents: null, spentMonthlyCents: 0, updatedAt: now },
        {
          type: "agent",
          localId: "ag-lead",
          squadLocalId: "sq-1",
          name: "Lead",
          role: "lead",
          status: "running",
          adapterType: "process",
          title: "Squad Lead",
          capabilities: "You coordinate the squad and triage issues.",
          reportsToLocalId: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 1200,
          updatedAt: now,
        },
        {
          type: "agent",
          localId: "ag-dev",
          squadLocalId: "sq-1",
          name: "Dev",
          role: "engineer",
          status: "idle",
          adapterType: "process",
          title: null,
          capabilities: null,
          reportsToLocalId: "ag-lead",
          budgetMonthlyCents: null,
          spentMonthlyCents: 0,
          updatedAt: now,
        },
        {
          type: "squad_skill",
          localId: "sk-1",
          squadLocalId: "sq-1",
          key: "pdf",
          name: "PDF Toolkit",
          description: "Extract and build PDFs",
          sourceType: "local_path",
          trustLevel: "markdown_only",
          updatedAt: now,
        },
      ],
      facts: [],
    };
    await applySyncBatch(db, instanceFk, batch);
    await linkSquadFks(db, instanceFk);

    const agents = await db.select().from(schema.agents).where(eq(schema.agents.instanceFk, instanceFk));
    expect(agents).toHaveLength(2);
    const lead = agents.find((a) => a.localId === "ag-lead")!;
    expect(lead.title).toBe("Squad Lead");
    expect(lead.capabilities).toContain("coordinate the squad");
    expect(lead.reportsToLocalId).toBeNull();
    const dev = agents.find((a) => a.localId === "ag-dev")!;
    expect(dev.reportsToLocalId).toBe("ag-lead");
    expect(dev.capabilities).toBeNull();
    // squadFk resolved by linkSquadFks
    expect(lead.squadFk).not.toBeNull();

    const skills = await db.select().from(schema.squadSkills).where(eq(schema.squadSkills.instanceFk, instanceFk));
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("PDF Toolkit");
    expect(skills[0].key).toBe("pdf");
    expect(skills[0].squadFk).not.toBeNull(); // linked to the squad
  });

  it("upserts agent metadata on conflict (instructions self-heal on re-send)", async () => {
    const later = new Date(Date.now() + 1000).toISOString();
    const batch: SyncRequest = {
      protocolVersion: PROTOCOL_VERSION,
      sentAt: later,
      batchCursor: "ag2",
      upserts: [
        {
          type: "agent",
          localId: "ag-lead",
          squadLocalId: "sq-1",
          name: "Lead",
          role: "lead",
          status: "running",
          adapterType: "process",
          title: "Squad Lead",
          capabilities: "Updated instructions: coordinate, triage, and report.",
          reportsToLocalId: null,
          budgetMonthlyCents: 5000,
          spentMonthlyCents: 1800,
          updatedAt: later,
        },
      ],
      facts: [],
    };
    await applySyncBatch(db, instanceFk, batch);
    const [lead] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.localId, "ag-lead"));
    expect(lead.capabilities).toContain("Updated instructions");
    expect(lead.spentMonthlyCents).toBe(1800);
  });
});

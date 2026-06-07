import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema } from "@slaw-botfather/db";
import type { BotfatherDb } from "@slaw-botfather/db";
import { eq } from "drizzle-orm";
import {
  createSkill,
  updateSkill,
  getSkill,
  listSkills,
  publishSkill,
  deprecateSkill,
  getCatalogVersion,
  getPublishedCatalog,
  getPublishedSkillContent,
  computeContentHash,
} from "../src/services/skill-registry.js";
import { evaluateAlerts } from "../src/services/alerts.js";
import { enroll, decideEnrollment, pollEnrollment } from "../src/services/enrollment.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../packages/db/migrations");
let db: BotfatherDb;

async function applyMigrations(client: PGlite) {
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(migrationsDir, f), "utf8").split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await client.exec(s);
    }
  }
}

beforeEach(async () => {
  const client = new PGlite();
  await applyMigrations(client);
  db = drizzle(client, { schema }) as unknown as BotfatherDb;
});

describe("content hash", () => {
  it("is stable and order-independent over files", () => {
    const a = computeContentHash("body", [
      { path: "b.txt", content: "2", encoding: "utf8" },
      { path: "a.txt", content: "1", encoding: "utf8" },
    ]);
    const b = computeContentHash("body", [
      { path: "a.txt", content: "1", encoding: "utf8" },
      { path: "b.txt", content: "2", encoding: "utf8" },
    ]);
    expect(a).toBe(b);
  });
  it("changes when the body changes", () => {
    expect(computeContentHash("x", [])).not.toBe(computeContentHash("y", []));
  });
});

describe("skill CRUD + draft lifecycle", () => {
  it("creates a draft, not served in the catalog", async () => {
    await createSkill(db, { key: "playwright-e2e", name: "Playwright E2E", markdown: "# run tests" });
    const s = await getSkill(db, "playwright-e2e");
    expect(s?.status).toBe("draft");
    expect(s?.version).toBe(1);
    const cat = await getPublishedCatalog(db);
    expect(cat.skills).toHaveLength(0);
    expect(cat.catalogVersion).toBe(0);
  });

  it("editing a draft does not bump version or catalog", async () => {
    await createSkill(db, { key: "k", name: "K", markdown: "v1" });
    await updateSkill(db, "k", { markdown: "v2" });
    const s = await getSkill(db, "k");
    expect(s?.version).toBe(1);
    expect(await getCatalogVersion(db)).toBe(0);
  });
});

describe("publish + version bump rule (must-not-regress)", () => {
  it("first publish keeps version 1, advances catalog, serves content", async () => {
    await createSkill(db, { key: "k", name: "K", markdown: "# body", trustLevel: "trusted" });
    const r = await publishSkill(db, "k");
    expect(r?.skill.version).toBe(1);
    expect(r?.contentChanged).toBe(true);
    expect(r?.catalogVersion).toBe(1);

    const cat = await getPublishedCatalog(db);
    expect(cat.skills).toHaveLength(1);
    expect(cat.skills[0]).toMatchObject({ key: "k", version: 1, trustLevel: "trusted", hasFiles: false });

    const content = await getPublishedSkillContent(db, "k");
    expect(content?.markdown).toBe("# body");
    expect(content?.version).toBe(1);
  });

  it("re-publishing UNCHANGED content does NOT bump the version", async () => {
    await createSkill(db, { key: "k", name: "K", markdown: "body" });
    await publishSkill(db, "k");
    const r2 = await publishSkill(db, "k");
    expect(r2?.skill.version).toBe(1);
    expect(r2?.contentChanged).toBe(false);
    // catalog version unchanged on a no-op republish
    expect(await getCatalogVersion(db)).toBe(1);
  });

  it("publishing CHANGED content bumps the version monotonically and the catalog", async () => {
    await createSkill(db, { key: "k", name: "K", markdown: "v1" });
    await publishSkill(db, "k");
    await updateSkill(db, "k", { markdown: "v2" });
    const r = await publishSkill(db, "k");
    expect(r?.skill.version).toBe(2);
    expect(r?.contentChanged).toBe(true);
    expect(r?.catalogVersion).toBe(2);

    await updateSkill(db, "k", { markdown: "v3" });
    const r3 = await publishSkill(db, "k");
    expect(r3?.skill.version).toBe(3);
    expect(r3?.catalogVersion).toBe(3);
  });

  it("version never goes BACKWARDS across deprecate→republish (the budget-limit class bug)", async () => {
    await createSkill(db, { key: "k", name: "K", markdown: "v1" });
    await publishSkill(db, "k"); // v1
    await updateSkill(db, "k", { markdown: "v2" });
    await publishSkill(db, "k"); // v2
    await deprecateSkill(db, "k");
    // republish unchanged deprecated content — must not drop below v2
    const r = await publishSkill(db, "k");
    expect(r?.skill.version).toBe(2);
    expect(r!.skill.version).toBeGreaterThanOrEqual(2);
  });
});

describe("metadata (two-axis) — NOT content, must not bump version", () => {
  it("persists metadata on create and flows it through catalog + content", async () => {
    await createSkill(db, {
      key: "ios-feature-dev",
      name: "iOS — Feature Development",
      markdown: "# body",
      metadata: { layer: "mobile-ios", discipline: "engineering", tags: ["swift"] },
    });
    await publishSkill(db, "ios-feature-dev");

    const cat = await getPublishedCatalog(db);
    expect(cat.skills[0].metadata).toMatchObject({
      layer: "mobile-ios",
      discipline: "engineering",
    });
    const content = await getPublishedSkillContent(db, "ios-feature-dev");
    expect(content?.metadata).toMatchObject({ layer: "mobile-ios", discipline: "engineering" });
  });

  it("editing ONLY metadata does not bump version or change contentHash, even after republish", async () => {
    await createSkill(db, {
      key: "k",
      name: "K",
      markdown: "stable body",
      metadata: { layer: "bff", discipline: "engineering" },
    });
    const first = await publishSkill(db, "k");
    expect(first?.skill.version).toBe(1);
    const hashV1 = first?.skill.contentHash;

    // change only the metadata (the layer), leave markdown/files untouched
    const edited = await updateSkill(db, "k", { metadata: { layer: "graphql", discipline: "engineering" } });
    expect(edited?.metadata).toMatchObject({ layer: "graphql" });

    const re = await publishSkill(db, "k");
    expect(re?.skill.version).toBe(1); // NOT bumped — metadata is not content
    expect(re?.contentChanged).toBe(false);
    expect(re?.skill.contentHash).toBe(hashV1);
    expect(await getCatalogVersion(db)).toBe(1);
  });

  it("normalizes non-object metadata to {}", async () => {
    await createSkill(db, { key: "k2", name: "K2", markdown: "b", metadata: "nope" as unknown });
    const s = await getSkill(db, "k2");
    expect(s?.metadata).toEqual({});
  });
});

describe("deprecate removes from catalog without uninstalling", () => {
  it("drops a published skill from the served catalog and advances catalog version", async () => {
    await createSkill(db, { key: "k", name: "K", markdown: "body" });
    await publishSkill(db, "k"); // catalog -> 1
    const dep = await deprecateSkill(db, "k");
    expect(dep?.catalogVersion).toBe(2);
    const cat = await getPublishedCatalog(db);
    expect(cat.skills).toHaveLength(0);
    // content pull returns null for a non-published skill
    expect(await getPublishedSkillContent(db, "k")).toBeNull();
  });

  it("deprecating a draft does NOT advance the catalog version", async () => {
    await createSkill(db, { key: "d", name: "D", markdown: "x" });
    const dep = await deprecateSkill(db, "d");
    expect(dep?.catalogVersion).toBe(0);
  });
});

describe("listing + missing", () => {
  it("filters by status and returns null for unknown keys", async () => {
    await createSkill(db, { key: "a", name: "A" });
    await createSkill(db, { key: "b", name: "B" });
    await publishSkill(db, "b");
    expect((await listSkills(db, { status: "published" })).map((s) => s.key)).toEqual(["b"]);
    expect((await listSkills(db)).length).toBe(2);
    expect(await getSkill(db, "nope")).toBeNull();
    expect(await getPublishedSkillContent(db, "nope")).toBeNull();
  });
});

describe("skill_version_drift alert (P6)", () => {
  async function enrolledInstance() {
    const e = await enroll(
      db,
      { machineId: "drift-test-1", instanceId: "default", hostname: "DRIFT-1", os: "linux", slawVersion: "0.4.2" },
      true,
    );
    await decideEnrollment(db, e.enrollmentId, "approve", "admin");
    await pollEnrollment(db, e.enrollmentId);
    const [inst] = await db.select().from(schema.instances).where(eq(schema.instances.instanceId, "default"));
    return inst.id;
  }

  it("raises when an active instance is below the catalog version, resolves once it catches up", async () => {
    const id = await enrolledInstance();
    await createSkill(db, { key: "k", name: "K", markdown: "x" });
    await publishSkill(db, "k"); // catalogVersion = 1, instance acked 0 → drift
    await evaluateAlerts(db);
    let active = await db.select().from(schema.alerts).where(eq(schema.alerts.rule, "skill_version_drift"));
    expect(active.filter((a) => a.status === "active")).toHaveLength(1);

    // instance acks the catalog → drift resolves
    await db.update(schema.instances).set({ skillCatalogVersionAcked: 1 }).where(eq(schema.instances.id, id));
    await evaluateAlerts(db);
    active = await db.select().from(schema.alerts).where(eq(schema.alerts.rule, "skill_version_drift"));
    expect(active.filter((a) => a.status === "active")).toHaveLength(0);
  });

  it("does not fire when no catalog is published", async () => {
    await enrolledInstance();
    await evaluateAlerts(db);
    const active = await db.select().from(schema.alerts).where(eq(schema.alerts.rule, "skill_version_drift"));
    expect(active.filter((a) => a.status === "active")).toHaveLength(0);
  });
});

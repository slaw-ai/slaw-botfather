import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema } from "@slaw-botfather/db";
import type { BotfatherDb } from "@slaw-botfather/db";
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

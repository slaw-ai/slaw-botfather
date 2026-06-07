import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema } from "@slaw-botfather/db";
import type { BotfatherDb } from "@slaw-botfather/db";
import { seedStandardSkills } from "../src/services/skill-registry-seed.js";
import { STANDARD_SKILLS } from "../src/services/standard-skills/manifest.js";
import {
  getPublishedCatalog,
  getSkill,
  updateSkill,
  publishSkill,
  listSkills,
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

describe("seedStandardSkills", () => {
  it("seeds the full manifest as published skills with metadata", async () => {
    const r = await seedStandardSkills(db, { enabled: true });
    expect(r.total).toBe(STANDARD_SKILLS.length);
    expect(r.created).toBe(STANDARD_SKILLS.length);
    expect(r.skipped).toBe(0);

    const cat = await getPublishedCatalog(db);
    expect(cat.skills).toHaveLength(STANDARD_SKILLS.length);

    // every entry is published, version 1, carries layer/discipline, category = layer
    const ios = await getSkill(db, "ios-feature-dev");
    expect(ios?.status).toBe("published");
    expect(ios?.version).toBe(1);
    expect(ios?.category).toBe("mobile-ios");
    expect(ios?.metadata).toMatchObject({ layer: "mobile-ios", discipline: "engineering" });

    // catalog descriptor also carries metadata
    const entry = cat.skills.find((s) => s.key === "ios-feature-dev");
    expect(entry?.metadata).toMatchObject({ layer: "mobile-ios", discipline: "engineering" });
  });

  it("is idempotent: re-running inserts nothing and bumps no versions", async () => {
    await seedStandardSkills(db, { enabled: true });
    const before = await getPublishedCatalog(db);
    const versionsBefore = Object.fromEntries(before.skills.map((s) => [s.key, s.version]));

    const r2 = await seedStandardSkills(db, { enabled: true });
    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(STANDARD_SKILLS.length);

    const after = await getPublishedCatalog(db);
    expect(after.skills).toHaveLength(STANDARD_SKILLS.length);
    expect(after.catalogVersion).toBe(before.catalogVersion); // no churn
    for (const s of after.skills) {
      expect(s.version).toBe(versionsBefore[s.key]); // never bumped
    }
  });

  it("does not overwrite an operator's edits on re-seed", async () => {
    await seedStandardSkills(db, { enabled: true });
    // operator edits a seeded skill's body and republishes (version → 2)
    await updateSkill(db, "code-review", { markdown: "# Operator's custom code review\n\nlocal rules" });
    const pub = await publishSkill(db, "code-review");
    expect(pub?.skill.version).toBe(2);

    await seedStandardSkills(db, { enabled: true });
    const edited = await getSkill(db, "code-review");
    expect(edited?.markdown).toContain("Operator's custom code review");
    expect(edited?.version).toBe(2); // untouched by re-seed
  });

  it("env gate off → seeds nothing", async () => {
    const r = await seedStandardSkills(db, { enabled: false });
    expect(r.created).toBe(0);
    expect(r.total).toBe(STANDARD_SKILLS.length);
    const all = await listSkills(db);
    expect(all).toHaveLength(0);
  });
});

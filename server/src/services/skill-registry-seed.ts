/**
 * Standard-skills seeding — populates the tower's `skill_library` with the
 * curated starter catalog (see standard-skills/manifest.ts + DESIGN §7).
 *
 * Properties:
 *  - Runs on the TOWER, once per tower database. Instances are never seeded;
 *    they pull the published catalog and install what they want.
 *  - IDEMPOTENT: a skill whose key already exists is skipped, so the seed never
 *    overwrites operator edits and is safe to re-run on every boot. Adding a new
 *    manifest entry later inserts only that key.
 *  - Auto-on-boot, env-gated (SEED_STANDARD_SKILLS); see index.ts.
 *  - Advisory-locked so two concurrent boots can't double-insert.
 *
 * Each seeded skill is created (draft) then published through the normal
 * createSkill → publishSkill path, so seeded rows are indistinguishable from
 * hand-authored ones and all registry invariants hold by construction.
 */

import { sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import { createSkill, publishSkill, getSkill } from "./skill-registry.js";
import { STANDARD_SKILLS } from "./standard-skills/manifest.js";

/** Stable lock id for the seed pass (arbitrary constant). */
const SEED_ADVISORY_LOCK_ID = 884422;

export interface SeedResult {
  /** number of skills newly inserted + published this pass */
  created: number;
  /** number skipped because the key already existed */
  skipped: number;
  /** total manifest size */
  total: number;
}

/**
 * Seed the standard catalog. Idempotent. Returns counts.
 * Honors SEED_STANDARD_SKILLS: any value other than the string "false" enables
 * seeding (default on). When disabled, returns zeros without touching the DB.
 */
export async function seedStandardSkills(
  db: BotfatherDb,
  opts: { enabled?: boolean } = {},
): Promise<SeedResult> {
  const enabled =
    opts.enabled ?? (process.env.SEED_STANDARD_SKILLS ?? "true") !== "false";
  const total = STANDARD_SKILLS.length;
  if (!enabled) return { created: 0, skipped: 0, total };

  // Serialize the whole pass against concurrent boots with a session-level
  // advisory lock. (No-op-safe on PGlite in tests.) We use the same db handle
  // throughout so the service functions keep their BotfatherDb type; getSkill's
  // existence check + the unique key index together make double-insert
  // impossible even if the lock were unavailable.
  await db.execute(sql`select pg_advisory_lock(${SEED_ADVISORY_LOCK_ID})`);
  try {
    let created = 0;
    let skipped = 0;
    for (const skill of STANDARD_SKILLS) {
      const existing = await getSkill(db, skill.key);
      if (existing) {
        skipped += 1;
        continue;
      }
      await createSkill(db, {
        key: skill.key,
        name: skill.name,
        description: skill.description,
        // category = layer for back-compat with the single-column filter;
        // the two-axis classification lives in metadata.
        category: skill.layer,
        markdown: skill.markdown,
        sourceType: "authored",
        trustLevel: "markdown_only",
        metadata: { layer: skill.layer, discipline: skill.discipline },
        createdBy: "standard-seed",
      });
      await publishSkill(db, skill.key);
      created += 1;
    }
    return { created, skipped, total };
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${SEED_ADVISORY_LOCK_ID})`);
  }
}

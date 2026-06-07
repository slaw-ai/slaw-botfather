/**
 * Skill catalog directive helper — the tower→instance HINT channel.
 *
 * Unlike budget limits (which push the full spec), skills push only a
 * lightweight `skills_updated` hint carrying the current catalogVersion. The
 * instance pulls the catalog + content on its own schedule. This preserves the
 * push-only model: no skill body ever rides the heartbeat/sync response.
 */
import { eq, sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import { instances } from "@slaw-botfather/db";
import type { Directive } from "@slaw/botfather-protocol";
import { getCatalogVersion } from "./skill-registry.js";

/**
 * Record what catalog version the instance reports having seen (monotonic — we
 * never move it backwards). Pure observability; the tower never forces a pull.
 */
export async function recordAppliedCatalogVersion(
  db: BotfatherDb,
  instanceFk: string,
  appliedVersion: number | undefined,
): Promise<void> {
  if (appliedVersion === undefined) return;
  await db
    .update(instances)
    .set({
      skillCatalogVersionAcked: sql`GREATEST(${instances.skillCatalogVersionAcked}, ${appliedVersion})`,
      updatedAt: new Date(),
    })
    .where(eq(instances.id, instanceFk));
}

/**
 * Emit a `skills_updated` hint iff the live catalog version is ahead of what
 * the instance last acked. Returns [] when the instance is already current.
 */
export async function buildSkillDirectives(
  db: BotfatherDb,
  instanceFk: string,
  ackedVersion: number,
): Promise<Directive[]> {
  const catalogVersion = await getCatalogVersion(db);
  if (catalogVersion <= ackedVersion) return [];
  return [{ kind: "skills_updated", catalogVersion }];
}

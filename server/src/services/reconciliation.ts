import { sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import type { ManifestRequest, ManifestResponse } from "@slaw/botfather-protocol";
import { rows } from "./sql-util.js";

async function countFor(db: BotfatherDb, tableName: string, instanceFk: string): Promise<number> {
  const r = rows<{ n: number }>(
    await db.execute(sql`SELECT count(*)::int AS n FROM ${sql.identifier(tableName)} WHERE instance_fk = ${instanceFk}`),
  );
  return r[0]?.n ?? 0;
}

/**
 * Compare the instance's manifest counts with botfather's view; flag every
 * entity type that diverges so the instance can full-resync just that type
 * (ARCHITECTURE §4.5).
 */
export async function reconcile(
  db: BotfatherDb,
  instanceFk: string,
  manifest: ManifestRequest,
): Promise<ManifestResponse> {
  const [sq, ag, pr, is, ce] = await Promise.all([
    countFor(db, "squads", instanceFk),
    countFor(db, "agents", instanceFk),
    countFor(db, "projects", instanceFk),
    countFor(db, "issues", instanceFk),
    countFor(db, "cost_facts", instanceFk),
  ]);

  const resyncTypes: ManifestResponse["resyncTypes"] = [];
  if (sq !== manifest.counts.squads) resyncTypes.push("squad");
  if (ag !== manifest.counts.agents) resyncTypes.push("agent");
  if (pr !== manifest.counts.projects) resyncTypes.push("project");
  if (is !== manifest.counts.issues) resyncTypes.push("issue");
  if (ce !== manifest.counts.costEvents) resyncTypes.push("cost_event");

  return { inSync: resyncTypes.length === 0, resyncTypes };
}

import { and, eq, lt, sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import { instances } from "@slaw-botfather/db";
import type { BotfatherConfig } from "../config.js";

/**
 * Marks instances offline after N missed heartbeats and stale after 24h
 * (ARCHITECTURE §4.2). Runs every 30s.
 */
export function startStatusSweeper(db: BotfatherDb, config: BotfatherConfig): NodeJS.Timeout {
  const sweep = async () => {
    const offlineCutoff = new Date(
      Date.now() - config.offlineAfterMissedHeartbeats * config.heartbeatIntervalSec * 1000,
    );
    const staleCutoff = new Date(Date.now() - config.staleAfterHours * 3600 * 1000);

    await db
      .update(instances)
      .set({ status: "offline", updatedAt: new Date() })
      .where(and(eq(instances.status, "ok"), lt(instances.lastHeartbeatAt, offlineCutoff)));

    await db
      .update(instances)
      .set({ status: "stale", updatedAt: new Date() })
      .where(and(eq(instances.status, "offline"), lt(instances.lastHeartbeatAt, staleCutoff)));
  };

  const timer = setInterval(() => {
    sweep().catch((err) => console.error("status sweep failed", err));
  }, 30_000);
  timer.unref();
  return timer;
}

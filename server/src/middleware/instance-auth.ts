import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import { instances } from "@slaw-botfather/db";
import { fingerprintApiKey, verifyApiKey } from "../services/api-keys.js";

export interface AuthedInstance {
  id: string;
  machineFk: string;
  instanceId: string;
  status: string;
  reportIssueTitles: boolean;
  lastSyncCursor: string | null;
}

/** Retrieve the authenticated instance set by instanceAuth. */
export function authedInstance(res: Response): AuthedInstance {
  return res.locals.instance as AuthedInstance;
}

export function instanceAuth(db: BotfatherDb) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!key) {
      res.status(401).json({ error: "missing bearer token", code: "unauthorized" });
      return;
    }
    const fp = fingerprintApiKey(key);
    const rows = await db.select().from(instances).where(eq(instances.apiKeyFingerprint, fp));
    for (const row of rows) {
      if (row.apiKeyHash && (await verifyApiKey(row.apiKeyHash, key))) {
        if (row.status === "revoked" || row.status === "rejected") {
          res.status(401).json({ error: "instance revoked", code: "enrollment_revoked" });
          return;
        }
        res.locals.instance = {
          id: row.id,
          machineFk: row.machineFk,
          instanceId: row.instanceId,
          status: row.status,
          reportIssueTitles: row.reportIssueTitles,
          lastSyncCursor: row.lastSyncCursor,
        } satisfies AuthedInstance;
        next();
        return;
      }
    }
    res.status(401).json({ error: "invalid api key", code: "unauthorized" });
  };
}

/** naive per-instance fixed-window rate limit (in-memory; fine for v1) */
export function ingestRateLimit(maxPerMinute: number) {
  const windows = new Map<string, { windowStart: number; count: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const id = (res.locals.instance as AuthedInstance | undefined)?.id ?? req.ip ?? "anon";
    const now = Date.now();
    const w = windows.get(id);
    if (!w || now - w.windowStart > 60_000) {
      windows.set(id, { windowStart: now, count: 1 });
      next();
      return;
    }
    w.count += 1;
    if (w.count > maxPerMinute) {
      res.status(429).json({ error: "rate limited", code: "rate_limited" });
      return;
    }
    next();
  };
}

import { Router, json } from "express";
import {
  enrollRequestSchema,
  enrollPollRequestSchema,
  heartbeatRequestSchema,
  syncRequestSchema,
  manifestRequestSchema,
  type EnrollResponse,
  type EnrollPollResponse,
  type HeartbeatResponse,
  type SyncResponse,
  type ManifestResponse,
} from "@slaw/botfather-protocol";
import { eq } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import { instances, machines } from "@slaw-botfather/db";
import { enroll, pollEnrollment } from "../services/enrollment.js";
import { applySyncBatch, linkSquadFks } from "../services/sync.js";
import { reconcile } from "../services/reconciliation.js";
import { buildLimitDirectives, recordAppliedLimitVersion } from "../services/limits.js";
import { instanceAuth, ingestRateLimit, authedInstance } from "../middleware/instance-auth.js";
import type { BotfatherConfig } from "../config.js";

export function ingestRouter(db: BotfatherDb, config: BotfatherConfig): Router {
  const r = Router();
  r.use(json({ limit: "4mb" }));

  /* ── token-less enrollment ── */
  r.post("/enroll", async (req, res) => {
    const parsed = enrollRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message, code: "invalid_payload" });
      return;
    }
    const result = await enroll(
      db,
      parsed.data.instance,
      parsed.data.capabilities.reportIssueTitles,
    );
    const body: EnrollResponse = {
      enrollmentId: result.enrollmentId,
      state: result.state,
      apiKey: result.apiKey,
      pollIntervalSec: 10,
    };
    res.status(result.state === "active" ? 200 : 202).json(body);
  });

  r.post("/enroll/poll", async (req, res) => {
    const parsed = enrollPollRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message, code: "invalid_payload" });
      return;
    }
    const result = await pollEnrollment(db, parsed.data.enrollmentId);
    if (!result) {
      res.status(404).json({ error: "enrollment not found", code: "enrollment_not_found" });
      return;
    }
    const body: EnrollPollResponse = {
      state: result.state,
      apiKey: result.apiKey,
      pollIntervalSec: 10,
    };
    res.json(body);
  });

  /* ── authenticated ingest ── */
  const auth = instanceAuth(db);
  const limit = ingestRateLimit(config.ingestRateLimitPerMin);

  // Any authenticated ingest call (heartbeat, sync, manifest) is proof the
  // instance is alive — refresh liveness so a busy instance that mostly syncs
  // isn't swept to "offline" between heartbeats. Cheap; runs per request.
  const touchLiveness = async (instanceId: string, machineFk: string) => {
    const now = new Date();
    await db
      .update(instances)
      .set({ status: "ok", lastHeartbeatAt: now, updatedAt: now })
      .where(eq(instances.id, instanceId));
    await db.update(machines).set({ lastSeen: now }).where(eq(machines.id, machineFk));
  };

  r.post("/heartbeat", auth, limit, async (req, res) => {
    const parsed = heartbeatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message, code: "invalid_payload" });
      return;
    }
    const inst = authedInstance(res);
    await touchLiveness(inst.id, inst.machineFk);
    // record the limit version the instance reports applied, then push the
    // effective limit if it's still behind.
    await recordAppliedLimitVersion(db, inst.id, parsed.data.appliedLimitVersion);
    const acked = parsed.data.appliedLimitVersion ?? inst.limitVersionAcked;
    const directives = await buildLimitDirectives(db, inst.id, acked);
    const body: HeartbeatResponse = { acknowledged: true, directives };
    res.json(body);
  });

  r.post("/sync", auth, limit, async (req, res) => {
    const parsed = syncRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message, code: "invalid_payload" });
      return;
    }
    const inst = authedInstance(res);
    const outcome = await applySyncBatch(db, inst.id, parsed.data);
    if (parsed.data.upserts.length > 0) await linkSquadFks(db, inst.id);
    await touchLiveness(inst.id, inst.machineFk);
    const directives = await buildLimitDirectives(db, inst.id, inst.limitVersionAcked);
    const body: SyncResponse = {
      acknowledgedCursor: parsed.data.batchCursor,
      accepted: outcome,
      directives,
    };
    res.json(body);
  });

  r.post("/manifest", auth, limit, async (req, res) => {
    const parsed = manifestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message, code: "invalid_payload" });
      return;
    }
    const inst = authedInstance(res);
    await touchLiveness(inst.id, inst.machineFk);
    const result: ManifestResponse = await reconcile(db, inst.id, parsed.data);
    res.json(result);
  });

  return r;
}

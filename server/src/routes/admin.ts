import { Router, json } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import {
  machines,
  instances,
  enrollments,
  autoApproveRules,
  squads,
  costFacts,
} from "@slaw-botfather/db";
import { decideEnrollment, revokeInstance } from "../services/enrollment.js";

/**
 * Admin API (v1: single local admin, no auth — bind to localhost / put behind
 * the corp reverse proxy; Entra SSO arrives in B5).
 */
export function adminRouter(db: BotfatherDb): Router {
  const r = Router();
  r.use(json());

  /* ── approval queue ── */
  r.get("/approvals", async (_req, res) => {
    const rows = await db
      .select({
        enrollmentId: enrollments.enrollmentId,
        requestedAt: enrollments.requestedAt,
        instanceId: instances.instanceId,
        slawVersion: instances.slawVersion,
        machineId: machines.machineId,
        hostname: machines.hostname,
        os: machines.os,
      })
      .from(enrollments)
      .innerJoin(instances, eq(enrollments.instanceFk, instances.id))
      .innerJoin(machines, eq(instances.machineFk, machines.id))
      .where(eq(enrollments.state, "pending"))
      .orderBy(desc(enrollments.requestedAt));
    res.json({ pending: rows });
  });

  r.post("/approvals/:enrollmentId/approve", async (req, res) => {
    const ok = await decideEnrollment(db, req.params.enrollmentId, "approve", "admin");
    res.status(ok ? 200 : 404).json({ ok });
  });

  r.post("/approvals/:enrollmentId/reject", async (req, res) => {
    const ok = await decideEnrollment(db, req.params.enrollmentId, "reject", "admin");
    res.status(ok ? 200 : 404).json({ ok });
  });

  /* ── auto-approve rules ── */
  r.get("/auto-approve-rules", async (_req, res) => {
    res.json({ rules: await db.select().from(autoApproveRules) });
  });

  r.post("/auto-approve-rules", async (req, res) => {
    const { pattern, field = "hostname" } = req.body ?? {};
    if (typeof pattern !== "string" || !pattern || !["hostname", "machineId"].includes(field)) {
      res.status(400).json({ error: "pattern (string) and field (hostname|machineId) required" });
      return;
    }
    const [rule] = await db
      .insert(autoApproveRules)
      .values({ pattern, field, createdBy: "admin" })
      .returning();
    res.status(201).json({ rule });
  });

  /* ── fleet ── */
  r.get("/fleet", async (_req, res) => {
    const rows = await db
      .select({
        id: instances.id,
        instanceId: instances.instanceId,
        status: instances.status,
        slawVersion: instances.slawVersion,
        lastHeartbeatAt: instances.lastHeartbeatAt,
        enrolledAt: instances.enrolledAt,
        machineId: machines.machineId,
        hostname: machines.hostname,
        os: machines.os,
        squadCount: sql<number>`(select count(*)::int from squads s where s.instance_fk = ${instances.id})`,
        spendTodayCents: sql<number>`coalesce((select sum(cf.cost_cents)::int from cost_facts cf where cf.instance_fk = ${instances.id} and cf.occurred_at >= date_trunc('day', now() at time zone 'utc')), 0)`,
        spendMtdCents: sql<number>`coalesce((select sum(cf.cost_cents)::int from cost_facts cf where cf.instance_fk = ${instances.id} and cf.occurred_at >= date_trunc('month', now() at time zone 'utc')), 0)`,
      })
      .from(instances)
      .innerJoin(machines, eq(instances.machineFk, machines.id))
      .orderBy(desc(instances.lastHeartbeatAt));
    res.json({ instances: rows });
  });

  r.get("/instances/:id", async (req, res) => {
    const [inst] = await db
      .select()
      .from(instances)
      .where(eq(instances.id, req.params.id));
    if (!inst) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const squadRows = await db
      .select()
      .from(squads)
      .where(eq(squads.instanceFk, inst.id));
    const costByModel = await db
      .select({
        model: costFacts.model,
        costCents: sql<number>`sum(${costFacts.costCents})::int`,
        inputTokens: sql<number>`sum(${costFacts.inputTokens})::bigint`,
        outputTokens: sql<number>`sum(${costFacts.outputTokens})::bigint`,
      })
      .from(costFacts)
      .where(
        and(
          eq(costFacts.instanceFk, inst.id),
          sql`${costFacts.occurredAt} >= date_trunc('month', now() at time zone 'utc')`,
        ),
      )
      .groupBy(costFacts.model);
    res.json({ instance: inst, squads: squadRows, costByModelMtd: costByModel });
  });

  r.post("/instances/:id/revoke", async (req, res) => {
    const ok = await revokeInstance(db, req.params.id, "admin");
    res.status(ok ? 200 : 404).json({ ok });
  });

  return r;
}

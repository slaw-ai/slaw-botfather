import { eq, sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import {
  instances,
  squads,
  agents,
  squadSkills,
  projects,
  issues,
  costFacts,
  runFacts,
  activityFacts,
} from "@slaw-botfather/db";
import type { SyncRequest, EntityUpsert, FactEvent } from "@slaw/botfather-protocol";

export interface SyncOutcome {
  upserts: number;
  facts: number;
  deduplicated: number;
}

async function applyUpsert(db: BotfatherDb, instanceFk: string, u: EntityUpsert): Promise<void> {
  const updatedAt = new Date(u.updatedAt);
  switch (u.type) {
    case "squad":
      await db
        .insert(squads)
        .values({
          instanceFk,
          localId: u.localId,
          name: u.name,
          status: u.status,
          budgetMonthlyCents: u.budgetMonthlyCents,
          spentMonthlyCents: u.spentMonthlyCents,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: [squads.instanceFk, squads.localId],
          set: {
            name: u.name,
            status: u.status,
            budgetMonthlyCents: u.budgetMonthlyCents,
            spentMonthlyCents: u.spentMonthlyCents,
            updatedAt,
          },
        });
      return;
    case "agent":
      await db
        .insert(agents)
        .values({
          instanceFk,
          localId: u.localId,
          squadLocalId: u.squadLocalId,
          name: u.name,
          role: u.role,
          status: u.status,
          adapterType: u.adapterType,
          title: u.title ?? null,
          capabilities: u.capabilities ?? null,
          reportsToLocalId: u.reportsToLocalId ?? null,
          budgetMonthlyCents: u.budgetMonthlyCents,
          spentMonthlyCents: u.spentMonthlyCents,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: [agents.instanceFk, agents.localId],
          set: {
            squadLocalId: u.squadLocalId,
            name: u.name,
            role: u.role,
            status: u.status,
            adapterType: u.adapterType,
            title: u.title ?? null,
            capabilities: u.capabilities ?? null,
            reportsToLocalId: u.reportsToLocalId ?? null,
            budgetMonthlyCents: u.budgetMonthlyCents,
            spentMonthlyCents: u.spentMonthlyCents,
            updatedAt,
          },
        });
      return;
    case "squad_skill":
      await db
        .insert(squadSkills)
        .values({
          instanceFk,
          localId: u.localId,
          squadLocalId: u.squadLocalId,
          key: u.key,
          name: u.name,
          description: u.description ?? null,
          sourceType: u.sourceType,
          trustLevel: u.trustLevel,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: [squadSkills.instanceFk, squadSkills.localId],
          set: {
            squadLocalId: u.squadLocalId,
            key: u.key,
            name: u.name,
            description: u.description ?? null,
            sourceType: u.sourceType,
            trustLevel: u.trustLevel,
            updatedAt,
          },
        });
      return;
    case "project":
      await db
        .insert(projects)
        .values({
          instanceFk,
          localId: u.localId,
          squadLocalId: u.squadLocalId,
          name: u.name,
          status: u.status,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: [projects.instanceFk, projects.localId],
          set: { squadLocalId: u.squadLocalId, name: u.name, status: u.status, updatedAt },
        });
      return;
    case "issue":
      await db
        .insert(issues)
        .values({
          instanceFk,
          localId: u.localId,
          squadLocalId: u.squadLocalId,
          projectLocalId: u.projectLocalId,
          title: u.title,
          status: u.status,
          assigneeAgentLocalId: u.assigneeAgentLocalId,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: [issues.instanceFk, issues.localId],
          set: {
            squadLocalId: u.squadLocalId,
            projectLocalId: u.projectLocalId,
            title: u.title,
            status: u.status,
            assigneeAgentLocalId: u.assigneeAgentLocalId,
            updatedAt,
          },
        });
      return;
  }
}

/** Insert a fact; returns true if inserted, false if deduplicated. */
export async function applyFact(db: BotfatherDb, instanceFk: string, f: FactEvent): Promise<boolean> {
  switch (f.type) {
    case "cost_event": {
      // Upsert (not insert-only): a cost_event's tokens/cost may be re-sent by
      // the instance if they were 0/stale on an earlier sync (e.g. usage
      // attached after the row was first observed). Keyed on (instanceFk,
      // localId); the numeric/model fields are corrected on conflict so the
      // tower's totals converge to the instance's authoritative values.
      await db
        .insert(costFacts)
        .values({
          instanceFk,
          localId: f.localId,
          squadLocalId: f.squadLocalId,
          agentLocalId: f.agentLocalId,
          issueLocalId: f.issueLocalId,
          projectLocalId: f.projectLocalId,
          provider: f.provider,
          biller: f.biller,
          billingType: f.billingType,
          model: f.model,
          inputTokens: f.inputTokens,
          cachedInputTokens: f.cachedInputTokens,
          outputTokens: f.outputTokens,
          costCents: f.costCents,
          occurredAt: new Date(f.occurredAt),
        })
        .onConflictDoUpdate({
          target: [costFacts.instanceFk, costFacts.localId],
          set: {
            provider: f.provider,
            biller: f.biller,
            billingType: f.billingType,
            model: f.model,
            inputTokens: f.inputTokens,
            cachedInputTokens: f.cachedInputTokens,
            outputTokens: f.outputTokens,
            costCents: f.costCents,
            occurredAt: new Date(f.occurredAt),
          },
        });
      // always count as accepted; upsert has no cheap inserted-vs-updated signal
      return true;
    }
    case "run_event": {
      const res = await db
        .insert(runFacts)
        .values({
          instanceFk,
          localId: f.localId,
          agentLocalId: f.agentLocalId,
          squadLocalId: f.squadLocalId,
          status: f.status,
          startedAt: f.startedAt ? new Date(f.startedAt) : null,
          finishedAt: f.finishedAt ? new Date(f.finishedAt) : null,
          inputTokens: f.inputTokens,
          outputTokens: f.outputTokens,
          occurredAt: new Date(f.occurredAt),
        })
        .onConflictDoNothing()
        .returning({ id: runFacts.id });
      return res.length > 0;
    }
    case "activity_event": {
      const res = await db
        .insert(activityFacts)
        .values({
          instanceFk,
          localId: f.localId,
          squadLocalId: f.squadLocalId,
          action: f.action,
          entityRef: f.entityRef,
          details: f.details,
          occurredAt: new Date(f.occurredAt),
        })
        .onConflictDoNothing()
        .returning({ id: activityFacts.id });
      return res.length > 0;
    }
  }
}

/**
 * Apply a sync batch. At-least-once delivery from the instance + unique
 * (instanceFk, localId) constraints here = effective exactly-once. The
 * cursor is only acknowledged after every row is applied.
 */
export async function applySyncBatch(
  db: BotfatherDb,
  instanceFk: string,
  batch: SyncRequest,
): Promise<SyncOutcome> {
  let upserts = 0;
  let facts = 0;
  let deduplicated = 0;

  for (const u of batch.upserts) {
    await applyUpsert(db, instanceFk, u);
    upserts += 1;
  }
  for (const f of batch.facts) {
    if (await applyFact(db, instanceFk, f)) facts += 1;
    else deduplicated += 1;
  }

  await db
    .update(instances)
    .set({ lastSyncCursor: batch.batchCursor, updatedAt: new Date() })
    .where(eq(instances.id, instanceFk));

  return { upserts, facts, deduplicated };
}

/** Single-fact path for the live WebSocket stream. */
export async function applyFactLive(db: BotfatherDb, instanceFk: string, f: FactEvent): Promise<boolean> {
  return applyFact(db, instanceFk, f);
}

/** Resolve squadFk references for mirrored entities (best-effort linker). */
export async function linkSquadFks(db: BotfatherDb, instanceFk: string): Promise<void> {
  await db.execute(sql`
    UPDATE agents a SET squad_fk = s.id
    FROM squads s
    WHERE a.instance_fk = ${instanceFk} AND s.instance_fk = a.instance_fk
      AND s.local_id = a.squad_local_id AND a.squad_fk IS DISTINCT FROM s.id
  `);
  await db.execute(sql`
    UPDATE issues i SET squad_fk = s.id
    FROM squads s
    WHERE i.instance_fk = ${instanceFk} AND s.instance_fk = i.instance_fk
      AND s.local_id = i.squad_local_id AND i.squad_fk IS DISTINCT FROM s.id
  `);
  await db.execute(sql`
    UPDATE projects p SET squad_fk = s.id
    FROM squads s
    WHERE p.instance_fk = ${instanceFk} AND s.instance_fk = p.instance_fk
      AND s.local_id = p.squad_local_id AND p.squad_fk IS DISTINCT FROM s.id
  `);
  await db.execute(sql`
    UPDATE squad_skills sk SET squad_fk = s.id
    FROM squads s
    WHERE sk.instance_fk = ${instanceFk} AND s.instance_fk = sk.instance_fk
      AND s.local_id = sk.squad_local_id AND sk.squad_fk IS DISTINCT FROM s.id
  `);
}

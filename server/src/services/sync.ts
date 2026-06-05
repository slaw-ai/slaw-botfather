import { eq, sql } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import {
  instances,
  squads,
  agents,
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
            budgetMonthlyCents: u.budgetMonthlyCents,
            spentMonthlyCents: u.spentMonthlyCents,
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
async function applyFact(db: BotfatherDb, instanceFk: string, f: FactEvent): Promise<boolean> {
  switch (f.type) {
    case "cost_event": {
      const res = await db
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
        .onConflictDoNothing()
        .returning({ id: costFacts.id });
      return res.length > 0;
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
}

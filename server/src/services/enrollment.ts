import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import {
  machines,
  instances,
  enrollments,
  autoApproveRules,
} from "@slaw-botfather/db";
import type { InstanceIdentity, EnrollmentState } from "@slaw/botfather-protocol";
import { generateApiKey, hashApiKey, fingerprintApiKey } from "./api-keys.js";

export interface EnrollResult {
  enrollmentId: string;
  state: EnrollmentState;
  apiKey?: string;
}

/** Simple glob → regex (supports * only, case-insensitive). */
export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(
    "^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i",
  );
  return re.test(value);
}

async function matchAutoApproveRule(
  db: BotfatherDb,
  identity: InstanceIdentity,
): Promise<string | null> {
  const rules = await db
    .select()
    .from(autoApproveRules)
    .where(eq(autoApproveRules.enabled, true));
  for (const rule of rules) {
    const value = rule.field === "machineId" ? identity.machineId : identity.hostname;
    if (globMatch(rule.pattern, value)) return rule.pattern;
  }
  return null;
}

/**
 * Token-less self-enrollment (ARCHITECTURE §6.2).
 * - upserts machine + instance
 * - re-enrollment of an active instance rotates the key immediately
 * - new instances go pending unless an auto-approve rule matches
 */
export async function enroll(
  db: BotfatherDb,
  identity: InstanceIdentity,
  reportIssueTitles: boolean,
): Promise<EnrollResult> {
  const now = new Date();

  // upsert machine
  let [machine] = await db
    .select()
    .from(machines)
    .where(eq(machines.machineId, identity.machineId));
  if (!machine) {
    [machine] = await db
      .insert(machines)
      .values({
        machineId: identity.machineId,
        hostname: identity.hostname,
        os: identity.os,
      })
      .returning();
  } else {
    await db
      .update(machines)
      .set({ hostname: identity.hostname, os: identity.os, lastSeen: now })
      .where(eq(machines.id, machine.id));
  }

  // upsert instance
  let [instance] = await db
    .select()
    .from(instances)
    .where(and(eq(instances.machineFk, machine.id), eq(instances.instanceId, identity.instanceId)));

  if (instance && instance.status === "rejected") {
    // explicit retry after rejection: back to pending below
  }

  if (instance && (instance.status === "ok" || instance.status === "offline" || instance.status === "stale")) {
    // already admitted → re-enrollment rotates the key
    const apiKey = generateApiKey();
    await db
      .update(instances)
      .set({
        apiKeyHash: await hashApiKey(apiKey),
        apiKeyFingerprint: fingerprintApiKey(apiKey),
        slawVersion: identity.slawVersion,
        reportIssueTitles,
        updatedAt: now,
      })
      .where(eq(instances.id, instance.id));
    const [enr] = await db
      .insert(enrollments)
      .values({
        enrollmentId: crypto.randomUUID(),
        instanceFk: instance.id,
        state: "active",
        decidedAt: now,
        decidedBy: "re-enroll(key-rotation)",
      })
      .returning();
    return { enrollmentId: enr.enrollmentId, state: "active", apiKey };
  }

  if (!instance) {
    [instance] = await db
      .insert(instances)
      .values({
        machineFk: machine.id,
        instanceId: identity.instanceId,
        slawVersion: identity.slawVersion,
        status: "pending",
        reportIssueTitles,
      })
      .returning();
  } else {
    await db
      .update(instances)
      .set({ slawVersion: identity.slawVersion, status: "pending", reportIssueTitles, updatedAt: now })
      .where(eq(instances.id, instance.id));
  }

  // auto-approve?
  const matchedRule = await matchAutoApproveRule(db, identity);
  if (matchedRule) {
    const apiKey = generateApiKey();
    await db
      .update(instances)
      .set({
        status: "ok",
        apiKeyHash: await hashApiKey(apiKey),
        apiKeyFingerprint: fingerprintApiKey(apiKey),
        enrolledAt: now,
        updatedAt: now,
      })
      .where(eq(instances.id, instance.id));
    const [enr] = await db
      .insert(enrollments)
      .values({
        enrollmentId: crypto.randomUUID(),
        instanceFk: instance.id,
        state: "active",
        decidedAt: now,
        decidedBy: "auto-approve",
        matchedRule,
      })
      .returning();
    return { enrollmentId: enr.enrollmentId, state: "active", apiKey };
  }

  // pending — admin must approve
  const [enr] = await db
    .insert(enrollments)
    .values({
      enrollmentId: crypto.randomUUID(),
      instanceFk: instance.id,
      state: "pending",
    })
    .returning();
  return { enrollmentId: enr.enrollmentId, state: "pending" };
}

/**
 * Poll enrollment state. On first poll after approval, issues the API key
 * (generated at approval time would mean storing it in plaintext — instead we
 * generate at poll time, exactly once, guarded by apiKeyHash being unset).
 */
export async function pollEnrollment(
  db: BotfatherDb,
  enrollmentId: string,
): Promise<{ state: EnrollmentState; apiKey?: string } | null> {
  const [enr] = await db
    .select()
    .from(enrollments)
    .where(eq(enrollments.enrollmentId, enrollmentId));
  if (!enr) return null;

  if (enr.state !== "active") return { state: enr.state as EnrollmentState };

  const [instance] = await db.select().from(instances).where(eq(instances.id, enr.instanceFk));
  if (!instance) return null;

  if (instance.apiKeyHash) {
    // key already issued (auto-approve path returned it inline, or a prior poll did)
    return { state: "active" };
  }

  const apiKey = generateApiKey();
  await db
    .update(instances)
    .set({
      apiKeyHash: await hashApiKey(apiKey),
      apiKeyFingerprint: fingerprintApiKey(apiKey),
      status: "ok",
      enrolledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(instances.id, instance.id));
  return { state: "active", apiKey };
}

/** Admin decision on a pending enrollment. */
export async function decideEnrollment(
  db: BotfatherDb,
  enrollmentId: string,
  decision: "approve" | "reject",
  decidedBy: string,
): Promise<boolean> {
  const [enr] = await db
    .select()
    .from(enrollments)
    .where(and(eq(enrollments.enrollmentId, enrollmentId), eq(enrollments.state, "pending")));
  if (!enr) return false;

  const now = new Date();
  await db
    .update(enrollments)
    .set({ state: decision === "approve" ? "active" : "rejected", decidedAt: now, decidedBy })
    .where(eq(enrollments.id, enr.id));
  await db
    .update(instances)
    .set({
      status: decision === "approve" ? "ok" : "rejected",
      updatedAt: now,
      // key is issued lazily on the instance's next poll
    })
    .where(eq(instances.id, enr.instanceFk));
  return true;
}

/** Revoke an admitted instance: kill the key, mark revoked. */
export async function revokeInstance(db: BotfatherDb, instanceId: string, by: string): Promise<boolean> {
  const [instance] = await db.select().from(instances).where(eq(instances.id, instanceId));
  if (!instance) return false;
  const now = new Date();
  await db
    .update(instances)
    .set({ status: "revoked", apiKeyHash: null, apiKeyFingerprint: null, updatedAt: now })
    .where(eq(instances.id, instance.id));
  await db.insert(enrollments).values({
    enrollmentId: crypto.randomUUID(),
    instanceFk: instance.id,
    state: "revoked",
    decidedAt: now,
    decidedBy: by,
  });
  return true;
}

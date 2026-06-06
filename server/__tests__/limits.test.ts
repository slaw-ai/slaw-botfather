import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { schema } from "@slaw-botfather/db";
import type { BotfatherDb } from "@slaw-botfather/db";
import { enroll, pollEnrollment, decideEnrollment } from "../src/services/enrollment.js";
import {
  getEnterpriseLimits,
  upsertEnterpriseLimits,
  getOverride,
  upsertOverride,
  clearOverride,
  resolveLimits,
  buildLimitDirectives,
  recordAppliedLimitVersion,
} from "../src/services/limits.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../packages/db/migrations");
let db: BotfatherDb;
let instanceFk: string;

async function applyMigrations(client: PGlite) {
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(migrationsDir, f), "utf8").split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await client.exec(s);
    }
  }
}

beforeEach(async () => {
  const client = new PGlite();
  await applyMigrations(client);
  db = drizzle(client, { schema }) as unknown as BotfatherDb;
  const e = await enroll(
    db,
    { machineId: "limits-test-1", instanceId: "default", hostname: "LIM-1", os: "linux", slawVersion: "0.4.2" },
    true,
  );
  await decideEnrollment(db, e.enrollmentId, "approve", "admin");
  await pollEnrollment(db, e.enrollmentId);
  const [inst] = await db.select().from(schema.instances).where(eq(schema.instances.instanceId, "default"));
  instanceFk = inst.id;
});

describe("limit resolution cascade", () => {
  it("returns an off spec when nothing is configured", async () => {
    const spec = await resolveLimits(db, instanceFk);
    expect(spec.mode).toBe("off");
    expect(spec.costLimitCents).toBeNull();
    expect(spec.tokenLimit).toBeNull();
    expect(spec.version).toBe(0);
  });

  it("an enterprise default applies to an instance with no override", async () => {
    await upsertEnterpriseLimits(db, {
      costLimitCents: 50_000,
      tokenLimit: 10_000_000,
      warnPercent: 75,
      mode: "soft",
      updatedBy: "admin",
    });
    const spec = await resolveLimits(db, instanceFk);
    expect(spec.costLimitCents).toBe(50_000);
    expect(spec.tokenLimit).toBe(10_000_000);
    expect(spec.warnPercent).toBe(75);
    expect(spec.mode).toBe("soft");
  });

  it("a per-instance override wins; null fields inherit the enterprise default", async () => {
    await upsertEnterpriseLimits(db, {
      costLimitCents: 50_000,
      tokenLimit: 10_000_000,
      warnPercent: 80,
      mode: "soft",
    });
    // override only the cost ceiling + hard mode; leave tokenLimit/warn null → inherit
    await upsertOverride(db, instanceFk, {
      costLimitCents: 20_000,
      tokenLimit: null,
      warnPercent: null,
      mode: "hard",
    });
    const spec = await resolveLimits(db, instanceFk);
    expect(spec.costLimitCents).toBe(20_000); // overridden
    expect(spec.tokenLimit).toBe(10_000_000); // inherited
    expect(spec.warnPercent).toBe(80); // inherited
    expect(spec.mode).toBe("hard"); // overridden
  });

  it("issues a higher version each time the effective content changes", async () => {
    // version is owned by the instance's monotonic issued counter, bumped by
    // buildLimitDirectives when content changes — not by resolveLimits alone.
    await upsertEnterpriseLimits(db, { costLimitCents: 100, tokenLimit: null, mode: "soft" });
    const v1 = (await buildLimitDirectives(db, instanceFk, 0))[0] as { limit: { version: number } };
    await upsertEnterpriseLimits(db, { costLimitCents: 200, tokenLimit: null, mode: "soft" });
    const v2 = (await buildLimitDirectives(db, instanceFk, v1.limit.version))[0] as { limit: { version: number } };
    expect(v2.limit.version).toBeGreaterThan(v1.limit.version);
  });

  it("clearing an override reverts the instance to the enterprise default", async () => {
    await upsertEnterpriseLimits(db, { costLimitCents: 50_000, tokenLimit: null, mode: "soft" });
    await upsertOverride(db, instanceFk, { costLimitCents: 10_000, tokenLimit: null, mode: "hard" });
    expect((await resolveLimits(db, instanceFk)).costLimitCents).toBe(10_000);
    await clearOverride(db, instanceFk);
    expect(await getOverride(db, instanceFk)).toBeNull();
    const spec = await resolveLimits(db, instanceFk);
    expect(spec.costLimitCents).toBe(50_000);
    expect(spec.mode).toBe("soft");
  });

  it("REGRESSION: clearing a hard override propagates with a HIGHER version (never backwards)", async () => {
    // Repro of the reported bug: a hard override is applied, then cleared with
    // no enterprise default → must push an "off" spec whose version exceeds the
    // version the instance already acked, so SLAW stops enforcing.
    await upsertOverride(db, instanceFk, { costLimitCents: null, tokenLimit: 2_000_000, mode: "hard" });
    const pushed = (await buildLimitDirectives(db, instanceFk, 0))[0] as { limit: { version: number; mode: string } };
    expect(pushed.limit.mode).toBe("hard");
    const ackedV = pushed.limit.version;
    await recordAppliedLimitVersion(db, instanceFk, ackedV);
    expect(await buildLimitDirectives(db, instanceFk, ackedV)).toHaveLength(0); // caught up

    // admin clears the override (DELETE) → nothing configured → "off"
    await clearOverride(db, instanceFk);
    const cleared = await buildLimitDirectives(db, instanceFk, ackedV);
    expect(cleared).toHaveLength(1); // <-- the bug was: this was [] (version went backwards)
    const spec = (cleared[0] as { limit: { version: number; mode: string } }).limit;
    expect(spec.mode).toBe("off");
    expect(spec.version).toBeGreaterThan(ackedV);
  });

  it("persists the enterprise singleton (single row, upsert not insert)", async () => {
    await upsertEnterpriseLimits(db, { costLimitCents: 1, tokenLimit: null });
    await upsertEnterpriseLimits(db, { costLimitCents: 2, tokenLimit: null });
    const all = await db.select().from(schema.enterpriseLimits);
    expect(all).toHaveLength(1);
    expect((await getEnterpriseLimits(db))?.costLimitCents).toBe(2);
  });
});

describe("directive emission + version de-dupe", () => {
  it("pushes set_limits when the instance is behind, then stops once acked", async () => {
    await upsertEnterpriseLimits(db, { costLimitCents: 50_000, tokenLimit: null, mode: "soft" });

    // instance has applied nothing yet (acked 0) → directive is pushed
    const first = await buildLimitDirectives(db, instanceFk, 0);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "set_limits" });
    const v = (first[0] as { limit: { version: number } }).limit.version;
    expect(v).toBeGreaterThan(0);

    // instance reports it applied that version → tower records it
    await recordAppliedLimitVersion(db, instanceFk, v);
    const [inst] = await db.select().from(schema.instances).where(eq(schema.instances.id, instanceFk));
    expect(inst.limitVersionAcked).toBe(v);

    // now the instance is caught up → nothing more to push (content unchanged)
    const second = await buildLimitDirectives(db, instanceFk, v);
    expect(second).toHaveLength(0);
  });

  it("re-pushes after an edit bumps the version", async () => {
    await upsertEnterpriseLimits(db, { costLimitCents: 10_000, tokenLimit: null, mode: "soft" });
    const v1 = ((await buildLimitDirectives(db, instanceFk, 0))[0] as { limit: { version: number } }).limit.version;
    await recordAppliedLimitVersion(db, instanceFk, v1);
    expect(await buildLimitDirectives(db, instanceFk, v1)).toHaveLength(0);

    // admin edits the limit → content changes → version moves forward → push again
    await upsertEnterpriseLimits(db, { costLimitCents: 20_000, tokenLimit: null, mode: "soft" });
    const dirs = await buildLimitDirectives(db, instanceFk, v1);
    expect(dirs).toHaveLength(1);
    const limit = (dirs[0] as { limit: { costLimitCents: number; version: number } }).limit;
    expect(limit.costLimitCents).toBe(20_000);
    expect(limit.version).toBeGreaterThan(v1);
  });

  it("emits nothing when no limit is configured", async () => {
    expect(await buildLimitDirectives(db, instanceFk, 0)).toHaveLength(0);
  });
});

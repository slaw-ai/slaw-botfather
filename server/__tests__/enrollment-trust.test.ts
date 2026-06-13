/**
 * Phase 2 (security remediation) — enrollment trust hardening (audit C2).
 *
 * Boots the real Express app on pglite and drives /api over HTTP to assert:
 *   - with BOTFATHER_ENROLLMENT_SECRET set, /enroll is rejected (401) without
 *     the secret and accepted with it (body field or header);
 *   - a wildcard auto-approve rule is refused at creation (400);
 *   - a specific (non-wildcard) rule is accepted and auto-admits a match.
 * Plus unit coverage of the isWildcardPattern guard.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { schema } from "@slaw-botfather/db";
import type { BotfatherDb } from "@slaw-botfather/db";
import type { BotfatherConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { isWildcardPattern } from "../src/services/enrollment.js";
import { PROTOCOL_VERSION } from "@slaw/botfather-protocol";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../packages/db/migrations");

async function applyMigrations(client: PGlite) {
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(path.join(migrationsDir, f), "utf8").split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await client.exec(s);
    }
  }
}

const baseConfig: BotfatherConfig = {
  port: 0,
  databaseUrl: undefined,
  embeddedPgPort: 0,
  offlineAfterMissedHeartbeats: 3,
  heartbeatIntervalSec: 60,
  staleAfterHours: 24,
  ingestRateLimitPerMin: 1000,
  bindHost: "127.0.0.1",
  adminToken: undefined,
  enrollmentSecret: undefined,
};

async function bootApp(config: BotfatherConfig): Promise<{ server: Server; base: string }> {
  const client = new PGlite();
  await applyMigrations(client);
  const db = drizzle(client, { schema }) as unknown as BotfatherDb;
  const app = createApp(db, config);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

function enrollBody(extra: Record<string, unknown> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    instance: {
      machineId: "trust-test-1",
      instanceId: "default",
      hostname: "TRUST-1",
      os: "linux",
      slawVersion: "0.4.2",
    },
    capabilities: { reportIssueTitles: true, liveStream: false },
    ...extra,
  };
}

const SECRET = "enroll-secret-cafebabe";

describe("isWildcardPattern", () => {
  it("flags overly-broad patterns", () => {
    for (const p of ["*", "*.*", " * ", "*.*.*", "*-*", "* . *"]) {
      expect(isWildcardPattern(p)).toBe(true);
    }
  });
  it("allows specific patterns", () => {
    for (const p of ["prod-*", "*.corp.internal", "web-0*", "host-1", "ENG-*-mac"]) {
      expect(isWildcardPattern(p)).toBe(false);
    }
  });
});

describe("enrollment secret gate", () => {
  let server: Server;
  let base: string;

  describe("when configured", () => {
    beforeEach(async () => {
      ({ server, base } = await bootApp({ ...baseConfig, enrollmentSecret: SECRET }));
    });

    it("rejects /enroll without the secret (no row written)", async () => {
      const res = await fetch(`${base}/api/ingest/v1/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(enrollBody()),
      });
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("enrollment_secret_required");
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("rejects a wrong secret", async () => {
      const res = await fetch(`${base}/api/ingest/v1/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(enrollBody({ enrollmentSecret: "nope" })),
      });
      expect(res.status).toBe(401);
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("accepts the secret in the body", async () => {
      const res = await fetch(`${base}/api/ingest/v1/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(enrollBody({ enrollmentSecret: SECRET })),
      });
      expect([200, 202]).toContain(res.status);
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("accepts the secret in the x-botfather-enrollment-secret header", async () => {
      const res = await fetch(`${base}/api/ingest/v1/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-botfather-enrollment-secret": SECRET },
        body: JSON.stringify(enrollBody()),
      });
      expect([200, 202]).toContain(res.status);
      await new Promise<void>((r) => server.close(() => r()));
    });
  });

  describe("when not configured", () => {
    it("enrolls without any secret (back-compat)", async () => {
      ({ server, base } = await bootApp({ ...baseConfig, enrollmentSecret: undefined }));
      const res = await fetch(`${base}/api/ingest/v1/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(enrollBody()),
      });
      expect([200, 202]).toContain(res.status);
      await new Promise<void>((r) => server.close(() => r()));
    });
  });
});

describe("auto-approve wildcard guardrail", () => {
  let server: Server;
  let base: string;

  beforeEach(async () => {
    ({ server, base } = await bootApp({ ...baseConfig }));
  });

  const createRule = (pattern: string, field = "hostname") =>
    fetch(`${base}/api/admin/auto-approve-rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pattern, field }),
    });

  it("refuses a wildcard rule at creation", async () => {
    const res = await createRule("*");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("wildcard_pattern_rejected");
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("refuses a *.* rule", async () => {
    const res = await createRule("*.*");
    expect(res.status).toBe(400);
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("accepts a specific pattern and auto-admits a matching enrollment", async () => {
    const created = await createRule("TRUST-*", "hostname");
    expect(created.status).toBe(201);

    const res = await fetch(`${base}/api/ingest/v1/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(enrollBody()),
    });
    // matched rule → active (200) with an apiKey, not pending (202)
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("active");
    expect(body.apiKey).toBeTruthy();
    await new Promise<void>((r) => server.close(() => r()));
  });
});

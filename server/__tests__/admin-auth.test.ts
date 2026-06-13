/**
 * Phase 1 (security remediation) — admin auth gate + safe bind.
 *
 * Drives the real Express app over HTTP across the three states the design
 * doc specifies for /api/admin:
 *   - token configured  → 401 without / 200 with the bearer token
 *   - no token, loopback → pass through (zero-config dev)
 *   - no token, exposed  → 503 (fail closed)
 * Plus a unit-level assertion that index.ts passes the bind host to listen.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

const ADMIN_PATH = "/api/admin/fleet";

describe("admin auth gate", () => {
  describe("token configured", () => {
    let server: Server;
    let base: string;
    const TOKEN = "test-admin-token-deadbeef";

    beforeAll(async () => {
      ({ server, base } = await bootApp({ ...baseConfig, adminToken: TOKEN }));
    });
    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("rejects with 401 when no token is supplied", async () => {
      const res = await fetch(`${base}${ADMIN_PATH}`);
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("unauthorized");
    });

    it("rejects with 401 on a wrong token", async () => {
      const res = await fetch(`${base}${ADMIN_PATH}`, {
        headers: { authorization: "Bearer not-the-token" },
      });
      expect(res.status).toBe(401);
    });

    it("admits with the correct bearer token", async () => {
      const res = await fetch(`${base}${ADMIN_PATH}`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      // 200 (or any non-auth status) — the gate let the request through to the router.
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });
  });

  describe("no token, loopback bind → dev convenience", () => {
    let server: Server;
    let base: string;
    beforeAll(async () => {
      ({ server, base } = await bootApp({ ...baseConfig, bindHost: "127.0.0.1", adminToken: undefined }));
    });
    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("passes through without auth", async () => {
      const res = await fetch(`${base}${ADMIN_PATH}`);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    });
  });

  describe("no token, exposed bind → fail closed", () => {
    let server: Server;
    let base: string;
    beforeAll(async () => {
      ({ server, base } = await bootApp({ ...baseConfig, bindHost: "0.0.0.0", adminToken: undefined }));
    });
    afterAll(async () => {
      await new Promise<void>((r) => server.close(() => r()));
    });

    it("returns 503 admin_auth_required", async () => {
      const res = await fetch(`${base}${ADMIN_PATH}`);
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("admin_auth_required");
    });
  });
});

describe("safe bind (index.ts)", () => {
  it("passes the configured bindHost as the listen() host argument", () => {
    const src = readFileSync(path.resolve(here, "../src/index.ts"), "utf8");
    // The listen call must thread the host through, not bind on all interfaces by default.
    expect(src).toMatch(/app\.listen\(\s*config\.port\s*,\s*config\.bindHost/);
  });

  it("refuses to start when exposed without an admin token", () => {
    const src = readFileSync(path.resolve(here, "../src/index.ts"), "utf8");
    expect(src).toMatch(/refusing to start/i);
    expect(src).toMatch(/config\.adminToken/);
  });
});

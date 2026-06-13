import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { BotfatherConfig } from "../config.js";

/**
 * Admin auth gate for /api/admin (Phase 1b of the security remediation plan).
 *
 * v1 is a single shared admin secret (BOTFATHER_ADMIN_TOKEN), compared in
 * constant time — mirroring the instance-auth bearer shape. Behaviour:
 *
 *   - token configured  → require a matching `Authorization: Bearer <token>`.
 *   - no token + loopback bind → allow (zero-config dev convenience).
 *   - no token + exposed bind   → fail closed with 503; the admin API must
 *     never be reachable off-box unauthenticated.
 *
 * SSO seam: keep this a single function so future EntraID/SSO work (B5) can
 * swap the body without touching route wiring.
 */
export function adminAuth(config: BotfatherConfig) {
  const exposed = config.bindHost !== "127.0.0.1" && config.bindHost !== "::1";

  return (req: Request, res: Response, next: NextFunction) => {
    const expected = config.adminToken;

    if (!expected) {
      // Fail closed when exposed; only the loopback dev path is unauthenticated.
      if (exposed) {
        res.status(503).json({
          error: "admin auth not configured",
          code: "admin_auth_required",
        });
        return;
      }
      next();
      return;
    }

    const header = req.header("authorization") ?? "";
    const got = header.startsWith("Bearer ") ? header.slice(7) : "";

    // Length check first so timingSafeEqual never sees mismatched buffers.
    const expectedBuf = Buffer.from(expected);
    const gotBuf = Buffer.from(got);
    const ok =
      gotBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(gotBuf, expectedBuf);

    if (!ok) {
      res.status(401).json({ error: "unauthorized", code: "unauthorized" });
      return;
    }
    next();
  };
}

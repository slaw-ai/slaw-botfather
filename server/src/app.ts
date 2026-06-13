import express from "express";
import type { BotfatherDb } from "@slaw-botfather/db";
import type { BotfatherConfig } from "./config.js";
import { ingestRouter } from "./routes/ingest.js";
import { adminRouter } from "./routes/admin.js";
import { adminAuth } from "./middleware/admin-auth.js";

export function createApp(db: BotfatherDb, config: BotfatherConfig): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, service: "botfather", version: "0.1.0" });
  });

  app.use("/api/ingest/v1", ingestRouter(db, config));
  app.use("/api/admin", adminAuth(config), adminRouter(db));

  return app;
}

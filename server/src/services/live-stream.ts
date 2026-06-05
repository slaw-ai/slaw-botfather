import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { eq } from "drizzle-orm";
import type { BotfatherDb } from "@slaw-botfather/db";
import { instances } from "@slaw-botfather/db";
import {
  liveHelloSchema,
  liveFrameSchema,
  type LiveAck,
  type FactEvent,
} from "@slaw/botfather-protocol";
import { fingerprintApiKey, verifyApiKey } from "./api-keys.js";
import { applyFactLive } from "./sync.js";

type Listener = (instanceFk: string, fact: FactEvent) => void;

/**
 * Live drill-down channel (ARCHITECTURE §4.4). Instances connect OUTBOUND to
 * /api/ingest/v1/live, authenticate with a hello frame, then stream fact
 * events in real time. Admin UIs subscribe in-process via subscribe().
 */
export class LiveHub {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(instanceFk: string, fact: FactEvent): void {
    for (const fn of this.listeners) fn(instanceFk, fact);
  }
}

export function attachLiveStream(server: Server, db: BotfatherDb, hub: LiveHub): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/api/ingest/v1/live" });

  wss.on("connection", (ws: WebSocket) => {
    let instanceFk: string | null = null;

    const ping = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 30_000);
    ping.unref?.();

    ws.on("message", async (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(1003, "invalid json");
        return;
      }

      // first frame must be a valid hello
      if (!instanceFk) {
        const hello = liveHelloSchema.safeParse(msg);
        if (!hello.success) {
          ws.close(1008, "expected hello");
          return;
        }
        const fp = fingerprintApiKey(hello.data.apiKey);
        const rows = await db.select().from(instances).where(eq(instances.apiKeyFingerprint, fp));
        let authed: string | null = null;
        for (const row of rows) {
          if (
            row.apiKeyHash &&
            row.status !== "revoked" &&
            (await verifyApiKey(row.apiKeyHash, hello.data.apiKey))
          ) {
            authed = row.id;
            break;
          }
        }
        if (!authed) {
          ws.close(1008, "unauthorized");
          return;
        }
        instanceFk = authed;
        const ack: LiveAck = { type: "ack", subscribed: true };
        ws.send(JSON.stringify(ack));
        return;
      }

      // subsequent frames: live fact events
      const frame = liveFrameSchema.safeParse(msg);
      if (!frame.success) return;
      if (frame.data.type === "ping") return;
      // persist (same dedupe path as batch sync) and fan out to admin subscribers
      await applyFactLive(db, instanceFk, frame.data.event);
      hub.emit(instanceFk, frame.data.event);
    });

    ws.on("close", () => clearInterval(ping));
    ws.on("error", () => clearInterval(ping));
  });

  return wss;
}

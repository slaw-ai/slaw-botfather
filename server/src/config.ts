export interface BotfatherConfig {
  port: number;
  /** external Postgres URL; when undefined the server boots embedded Postgres */
  databaseUrl: string | undefined;
  /** port for the embedded Postgres (ignored when databaseUrl is set) */
  embeddedPgPort: number;
  /** instance marked offline after this many missed heartbeat intervals */
  offlineAfterMissedHeartbeats: number;
  heartbeatIntervalSec: number;
  staleAfterHours: number;
  /** max sync requests per instance per minute */
  ingestRateLimitPerMin: number;
}

export function loadConfig(): BotfatherConfig {
  return {
    port: Number(process.env.BOTFATHER_PORT ?? 8400),
    // unset → embedded Postgres is auto-started (zero-config dev, like SLAW)
    databaseUrl: process.env.BOTFATHER_DATABASE_URL || undefined,
    embeddedPgPort: Number(process.env.BOTFATHER_EMBEDDED_PG_PORT ?? 54330),
    offlineAfterMissedHeartbeats: 3,
    heartbeatIntervalSec: 60,
    staleAfterHours: 24,
    ingestRateLimitPerMin: Number(process.env.BOTFATHER_RATE_LIMIT ?? 120),
  };
}

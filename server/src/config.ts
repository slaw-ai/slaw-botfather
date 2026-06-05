export interface BotfatherConfig {
  port: number;
  databaseUrl: string;
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
    databaseUrl:
      process.env.BOTFATHER_DATABASE_URL ??
      "postgres://postgres:postgres@127.0.0.1:54330/botfather",
    offlineAfterMissedHeartbeats: 3,
    heartbeatIntervalSec: 60,
    staleAfterHours: 24,
    ingestRateLimitPerMin: Number(process.env.BOTFATHER_RATE_LIMIT ?? 120),
  };
}

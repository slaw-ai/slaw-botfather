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
  /**
   * Host the HTTP server binds to. Loopback by default so a fresh tower is
   * never reachable off-box; operators fronting it with a proxy set
   * BOTFATHER_BIND=0.0.0.0 deliberately.
   */
  bindHost: string;
  /**
   * Shared admin secret guarding /api/admin (compared constant-time).
   * Undefined → loopback-only dev convenience; required once exposed.
   */
  adminToken: string | undefined;
  /**
   * Optional pre-shared enrollment secret. When set, POST /enroll must carry a
   * matching value (constant-time compared) or it is rejected before any row is
   * written — converting "anyone on the network can create pending rows" into
   * "only callers holding the shared secret can". Undefined → token-less
   * enrollment (admin still gates admission of the pending queue).
   */
  enrollmentSecret: string | undefined;
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
    bindHost: process.env.BOTFATHER_BIND ?? "127.0.0.1",
    adminToken: process.env.BOTFATHER_ADMIN_TOKEN || undefined,
    enrollmentSecret: process.env.BOTFATHER_ENROLLMENT_SECRET || undefined,
  };
}

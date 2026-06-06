/** Thin client for the botfather admin API. */
const BASE = "/api/admin";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

/* ── types (mirror server responses) ── */
export interface FleetInstance {
  id: string;
  instanceId: string;
  status: string;
  slawVersion: string;
  lastHeartbeatAt: string | null;
  enrolledAt: string | null;
  machineId: string;
  hostname: string;
  os: string;
  squadCount: number;
  spendTodayCents: number;
  spendMtdCents: number;
}

export interface NetworkSummary {
  spendTodayCents: number;
  spendMtdCents: number;
  forecastEomCents: number;
  inputTokensMtd: number;
  cachedInputTokensMtd: number;
  outputTokensMtd: number;
  issuesClosedMtd: number;
  costPerIssueCents: number;
}

export interface Alert {
  id: string;
  rule: string;
  severity: "critical" | "warning" | "info";
  status: string;
  title: string;
  detail: string;
  firstSeenAt: string;
}

export interface PendingEnrollment {
  enrollmentId: string;
  requestedAt: string;
  instanceId: string;
  slawVersion: string;
  machineId: string;
  hostname: string;
  os: string;
}

export const api = {
  fleet: () => get<{ instances: FleetInstance[] }>("/fleet"),
  summary: () => get<NetworkSummary>("/analytics/summary"),
  cost: (days = 14) =>
    get<{
      byDay: { day: string; cost_cents: number }[];
      byModel: { model: string; cost_cents: number; input_tokens: number; output_tokens: number }[];
      byBilling: { billing_type: string; cost_cents: number }[];
      topInstances: { hostname: string; instance_id: string; instance_id_fk: string; cost_cents: number; tokens: number }[];
      topSquads: {
        squad_local_id: string;
        squad_name: string | null;
        hostname: string;
        cost_cents: number;
        budget_monthly_cents: number | null;
      }[];
    }>(`/analytics/cost?days=${days}`),
  instance: (id: string) =>
    get<{
      instance: FleetInstance & { reportIssueTitles: boolean };
      squads: { id: string; localId: string; name: string; status: string; budgetMonthlyCents: number | null; spentMonthlyCents: number }[];
      agentsBySquad: Record<string, { total: number; byStatus: Record<string, number> }>;
      costByModelMtd: { model: string; costCents: number; inputTokens: number; cachedInputTokens: number; outputTokens: number }[];
      tokensMtd: {
        inputTokens: number;
        cachedInputTokens: number;
        outputTokens: number;
        totalTokens: number;
        events: number;
        subscriptionDominant: boolean;
      };
    }>(`/instances/${id}`),
  instanceIssues: (id: string) =>
    get<{
      issues: {
        localId: string;
        title: string;
        status: string;
        squadLocalId: string;
        assigneeAgentLocalId: string | null;
        updatedAt: string;
        squadName: string | null;
      }[];
    }>(`/instances/${id}/issues`),
  instanceAgents: (id: string) =>
    get<{
      agents: {
        localId: string;
        squadLocalId: string;
        name: string;
        role: string;
        title: string | null;
        status: string;
        adapterType: string;
        capabilities: string | null;
        reportsToLocalId: string | null;
        budgetMonthlyCents: number | null;
        spentMonthlyCents: number;
        updatedAt: string;
        squadName: string | null;
      }[];
    }>(`/instances/${id}/agents`),
  instanceSkills: (id: string) =>
    get<{
      skills: {
        localId: string;
        squadLocalId: string;
        key: string;
        name: string;
        description: string | null;
        sourceType: string;
        trustLevel: string;
        updatedAt: string;
        squadName: string | null;
      }[];
    }>(`/instances/${id}/skills`),
  alerts: (status = "active") => get<{ alerts: Alert[] }>(`/alerts?status=${status}`),
  acknowledgeAlert: (id: string) => post<{ ok: boolean }>(`/alerts/${id}/acknowledge`),
  approvals: () => get<{ pending: PendingEnrollment[] }>("/approvals"),
  approve: (eid: string) => post<{ ok: boolean }>(`/approvals/${eid}/approve`),
  reject: (eid: string) => post<{ ok: boolean }>(`/approvals/${eid}/reject`),
  autoApproveRules: () =>
    get<{ rules: { id: string; pattern: string; field: string; enabled: boolean }[] }>("/auto-approve-rules"),
  revoke: (id: string) => post<{ ok: boolean }>(`/instances/${id}/revoke`),

  enterpriseLimits: () => get<{ enterprise: EnterpriseLimits | null }>("/enterprise-limits"),
  setEnterpriseLimits: (body: LimitInput) => put<{ enterprise: EnterpriseLimits }>("/enterprise-limits", body),
  instanceLimits: (id: string) =>
    get<{
      effective: LimitSpec;
      override: InstanceLimitOverride | null;
      enterprise: EnterpriseLimits | null;
      appliedVersion: number;
    }>(`/instances/${id}/limits`),
  setInstanceLimits: (id: string, body: LimitInput) =>
    put<{ override: InstanceLimitOverride; effective: LimitSpec }>(`/instances/${id}/limits`, body),
  clearInstanceLimits: (id: string) =>
    del<{ ok: boolean; effective: LimitSpec }>(`/instances/${id}/limits`),
};

export type LimitMode = "off" | "soft" | "hard";

export interface LimitSpec {
  costLimitCents: number | null;
  tokenLimit: number | null;
  window: string;
  warnPercent: number;
  mode: LimitMode;
  version: number;
}

export interface EnterpriseLimits {
  costLimitCents: number | null;
  tokenLimit: number | null;
  warnPercent: number;
  mode: LimitMode;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface InstanceLimitOverride {
  costLimitCents: number | null;
  tokenLimit: number | null;
  warnPercent: number | null;
  mode: LimitMode | null;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface LimitInput {
  costLimitCents: number | null;
  tokenLimit: number | null;
  warnPercent?: number | null;
  mode?: LimitMode | null;
}

export const money = (cents: number | null | undefined) => {
  const c = Number(cents);
  const safe = Number.isFinite(c) ? c : 0;
  return `$${(safe / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const compact = (n: number | null | undefined) => {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  return safe >= 1e9 ? `${(safe / 1e9).toFixed(1)}B` : safe >= 1e6 ? `${(safe / 1e6).toFixed(1)}M` : safe >= 1e3 ? `${(safe / 1e3).toFixed(1)}K` : String(safe);
};

/* ── limit-input parse/format helpers (shared by the Limits page + override panel) ──
 * Cost is entered as whole dollars, displayed grouped (50,000 — no cents).
 * Tokens accept suffix shorthand (20M / 1.5B / 750K), raw digits, or grouped
 * digits, and are displayed in the shortest exact shorthand. Empty = no cap.
 */

/** "50,000" / "50000" / "$50,000" → cents (5_000_000). Empty/invalid → null. */
export function parseDollarsToCents(input: string): number | null {
  const t = input.trim().replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** cents → grouped whole-dollar string for the input field ("50,000"). */
export function formatCentsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return Math.round(cents / 100).toLocaleString("en-US");
}

/** "20M" / "1.5B" / "750K" / "20,000,000" / "20000000" → tokens. Empty/invalid → null. */
export function parseTokenInput(input: string): number | null {
  const t = input.trim().replace(/[,\s]/g, "").toUpperCase();
  if (t === "") return null;
  const m = t.match(/^(\d+(?:\.\d+)?)([KMB])?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const mult = m[2] === "B" ? 1e9 : m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1;
  return Math.round(n * mult);
}

/** tokens → shortest readable shorthand for the input field (20000000 → "20M"). */
export function formatTokensToInput(tokens: number | null | undefined): string {
  if (tokens == null) return "";
  const n = tokens;
  if (n === 0) return "0";
  // Use a suffix only when the value stays readable — i.e. ≤1 decimal place at
  // that unit (20M, 1.5B, 750K). A messy value like 1,234,567 falls back to
  // grouped digits rather than an unreadable "1234.567K".
  const units: Array<[number, string]> = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [base, suf] of units) {
    // only the unit where the value sits (1 ≤ val < 1000), so 1,250,000 is
    // considered at "M" (1.25 → 2dp → rejected), never demoted to "1250K".
    if (n >= base && n < base * 1000) {
      const val = n / base;
      const rounded = Math.round(val * 10) / 10; // 1 decimal
      if (rounded * base === n) return `${rounded}${suf}`;
    }
  }
  return n.toLocaleString("en-US");
}

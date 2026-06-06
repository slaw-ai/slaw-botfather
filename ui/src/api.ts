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
      costByModelMtd: { model: string; costCents: number }[];
    }>(`/instances/${id}`),
  issues: (status = "in_progress") =>
    get<{
      issues: {
        localId: string;
        title: string;
        status: string;
        squadLocalId: string;
        assigneeAgentLocalId: string | null;
        updatedAt: string;
        hostname: string;
        instanceFk: string;
        squadName: string | null;
      }[];
    }>(`/issues?status=${status}`),
  alerts: (status = "active") => get<{ alerts: Alert[] }>(`/alerts?status=${status}`),
  acknowledgeAlert: (id: string) => post<{ ok: boolean }>(`/alerts/${id}/acknowledge`),
  approvals: () => get<{ pending: PendingEnrollment[] }>("/approvals"),
  approve: (eid: string) => post<{ ok: boolean }>(`/approvals/${eid}/approve`),
  reject: (eid: string) => post<{ ok: boolean }>(`/approvals/${eid}/reject`),
  autoApproveRules: () =>
    get<{ rules: { id: string; pattern: string; field: string; enabled: boolean }[] }>("/auto-approve-rules"),
  revoke: (id: string) => post<{ ok: boolean }>(`/instances/${id}/revoke`),
};

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

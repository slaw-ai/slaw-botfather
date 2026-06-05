import { useNavigate } from "react-router-dom";
import { api, money, compact } from "../api.ts";
import { useFetch } from "../useFetch.ts";
import { ThemeButton } from "../Shell.tsx";

const statusClass: Record<string, string> = {
  ok: "ok",
  offline: "off",
  stale: "stale",
  pending: "stale",
  rejected: "off",
  revoked: "off",
};

function rel(ts: string | null): string {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function Fleet() {
  const nav = useNavigate();
  const fleet = useFetch(() => api.fleet(), [], 15_000);
  const summary = useFetch(() => api.summary(), [], 15_000);
  const alerts = useFetch(() => api.alerts("active"), [], 15_000);

  const instances = fleet.data?.instances ?? [];
  const online = instances.filter((i) => i.status === "ok").length;
  const s = summary.data;

  return (
    <>
      <div className="topbar">
        <h1>Fleet</h1>
        <span className="crumb">
          {instances.length} instances · {instances.reduce((n, i) => n + i.squadCount, 0)} squads
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <ThemeButton />
          <div className="avatar">FZ</div>
        </div>
      </div>

      <div className="content">
        <div className="kpis c5">
          <div className="kpi">
            <div className="lbl">Instances Online</div>
            <div className="val">
              {online}
              <span className="dim" style={{ fontSize: 15 }}>
                /{instances.length}
              </span>
            </div>
            <div className="sub">{instances.filter((i) => i.status !== "ok").length} not reporting</div>
          </div>
          <div className="kpi">
            <div className="lbl">Spend Today</div>
            <div className="val">{s ? money(s.spendTodayCents) : "—"}</div>
          </div>
          <div className="kpi">
            <div className="lbl">Spend MTD</div>
            <div className="val">{s ? money(s.spendMtdCents) : "—"}</div>
            <div className="sub">forecast {s ? money(s.forecastEomCents) : "—"}</div>
          </div>
          <div className="kpi">
            <div className="lbl">Tokens MTD</div>
            <div className="val">{s ? compact(s.inputTokensMtd + s.outputTokensMtd) : "—"}</div>
            <div className="sub">{s ? `${compact(s.inputTokensMtd)} in · ${compact(s.outputTokensMtd)} out` : ""}</div>
          </div>
          <div className="kpi alert">
            <div className="lbl">Active Alerts</div>
            <div className="val">{alerts.data?.alerts.length ?? 0}</div>
            <div className="sub">{alerts.data?.alerts.filter((a) => a.severity === "critical").length ?? 0} critical</div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2>Instances</h2>
            <span className="dim" style={{ fontSize: 11 }}>auto-refresh 15s</span>
          </div>
          {fleet.loading ? (
            <div className="loading">loading fleet…</div>
          ) : instances.length === 0 ? (
            <div className="empty">No instances enrolled yet. Approve one in Approvals &amp; Admin.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Machine / Instance</th>
                  <th>Status</th>
                  <th>Squads</th>
                  <th className="r">Spend Today</th>
                  <th className="r">Spend MTD</th>
                  <th>SLAW</th>
                  <th>Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((i) => (
                  <tr key={i.id} className="click" onClick={() => nav(`/instances/${i.id}`)}>
                    <td>
                      <div className="mach">
                        <div className="os" />
                        <div>
                          <div className="nm">{i.hostname}</div>
                          <div className="id">
                            {i.machineId.slice(0, 8)}… · {i.instanceId}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`st ${statusClass[i.status] ?? "stale"}`}>
                        <i />
                        {i.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="mono">{i.squadCount}</td>
                    <td className="r mono">{money(i.spendTodayCents)}</td>
                    <td className="r mono">{money(i.spendMtdCents)}</td>
                    <td className="mono" style={{ fontSize: 10, color: "var(--dim)" }}>{i.slawVersion}</td>
                    <td className="dim mono" style={{ fontSize: 11 }}>{rel(i.lastHeartbeatAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

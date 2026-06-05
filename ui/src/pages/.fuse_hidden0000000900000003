import { useNavigate } from "react-router-dom";
import { api } from "../api.ts";
import { useFetch } from "../useFetch.ts";
import { ThemeButton } from "../Shell.tsx";

function rel(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function Issues() {
  const nav = useNavigate();
  const { data, loading } = useFetch(() => api.issues("in_progress"), [], 15_000);
  const issues = data?.issues ?? [];

  return (
    <>
      <div className="topbar">
        <h1>Issues in Flight</h1>
        <span className="crumb">what the fleet is working on right now</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <ThemeButton />
          <div className="avatar">FZ</div>
        </div>
      </div>

      <div className="content">
        <div className="kpis c4">
          <div className="kpi">
            <div className="lbl">In Progress Now</div>
            <div className="val">{issues.length}</div>
          </div>
          <div className="kpi">
            <div className="lbl">Squads Active</div>
            <div className="val">{new Set(issues.map((i) => i.squadLocalId)).size}</div>
          </div>
          <div className="kpi">
            <div className="lbl">Instances Active</div>
            <div className="val">{new Set(issues.map((i) => i.instanceFk)).size}</div>
          </div>
          <div className="kpi">
            <div className="lbl">Assigned</div>
            <div className="val">{issues.filter((i) => i.assigneeAgentLocalId).length}</div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2>Live — In Progress</h2>
            <span className="dim" style={{ fontSize: 11 }}>auto-refresh 15s · titles only</span>
          </div>
          {loading ? (
            <div className="loading">loading…</div>
          ) : issues.length === 0 ? (
            <div className="empty">Nothing in progress across the fleet right now.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Title</th>
                  <th>Squad</th>
                  <th>Instance</th>
                  <th>Agent</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={`${i.instanceFk}-${i.localId}`} className="click" onClick={() => nav(`/instances/${i.instanceFk}`)}>
                    <td className="mono" style={{ fontSize: 11 }}>{i.localId}</td>
                    <td>
                      <b>{i.title}</b>
                    </td>
                    <td>
                      <span className="tag">{i.squadName ?? i.squadLocalId}</span>
                    </td>
                    <td className="dim">{i.hostname}</td>
                    <td className="muted">{i.assigneeAgentLocalId ?? "—"}</td>
                    <td className="dim mono" style={{ fontSize: 11 }}>{rel(i.updatedAt)}</td>
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

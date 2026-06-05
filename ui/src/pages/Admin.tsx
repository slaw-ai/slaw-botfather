import { useState } from "react";
import { api } from "../api.ts";
import { useFetch } from "../useFetch.ts";
import { ThemeButton } from "../Shell.tsx";

function rel(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function Admin() {
  const approvals = useFetch(() => api.approvals(), [], 10_000);
  const rules = useFetch(() => api.autoApproveRules(), []);
  const fleet = useFetch(() => api.fleet(), [], 20_000);
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (eid: string, action: "approve" | "reject") => {
    setBusy(eid);
    await (action === "approve" ? api.approve(eid) : api.reject(eid));
    await approvals.reload();
    await fleet.reload();
    setBusy(null);
  };

  const pending = approvals.data?.pending ?? [];
  const enrolled = (fleet.data?.instances ?? []).filter((i) => i.status !== "pending");

  return (
    <>
      <div className="topbar">
        <h1>Approvals &amp; Admin</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <ThemeButton />
          <div className="avatar">FZ</div>
        </div>
      </div>

      <div className="content">
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-h">
            <h2>Approval Queue</h2>
            {pending.length > 0 && <span className="pill warn">{pending.length} PENDING</span>}
          </div>
          {pending.length === 0 ? (
            <div className="empty">No instances awaiting approval.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Machine / Instance</th>
                  <th>Identity</th>
                  <th>SLAW</th>
                  <th>Requested</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.map((p) => (
                  <tr key={p.enrollmentId}>
                    <td>
                      <div className="mach">
                        <div className="os" />
                        <div>
                          <div className="nm">
                            {p.hostname} <span className="dim" style={{ fontWeight: 400 }}>· {p.instanceId}</span>
                          </div>
                          <div className="id">new machine</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>{p.machineId.slice(0, 8)}…</td>
                    <td className="mono" style={{ fontSize: 11 }}>{p.slawVersion}</td>
                    <td className="dim mono" style={{ fontSize: 11 }}>{rel(p.requestedAt)}</td>
                    <td className="r" style={{ whiteSpace: "nowrap" }}>
                      <button className="btn" disabled={busy === p.enrollmentId} style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => decide(p.enrollmentId, "approve")}>
                        Approve
                      </button>{" "}
                      <button className="btn danger" disabled={busy === p.enrollmentId} style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => decide(p.enrollmentId, "reject")}>
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="row cols-1-1" style={{ display: "grid", gap: 12 }}>
          <div className="panel">
            <div className="panel-h">
              <h2>Auto-Approve Rules</h2>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Pattern</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(rules.data?.rules ?? []).map((rule) => (
                  <tr key={rule.id}>
                    <td className="muted">{rule.field}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{rule.pattern}</td>
                    <td className="r">
                      <span className={`pill ${rule.enabled ? "ok" : "dim"}`}>{rule.enabled ? "ON" : "OFF"}</span>
                    </td>
                  </tr>
                ))}
                {!rules.data?.rules.length && (
                  <tr>
                    <td colSpan={3} className="empty">No rules — every instance needs manual approval.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2>Enrolled Instances</h2>
              <span className="dim" style={{ fontSize: 11 }}>{enrolled.length} total</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Machine / Instance</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {enrolled.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div className="mach">
                        <div className="os" />
                        <div>
                          <div className="nm">{i.hostname}</div>
                          <div className="id">{i.machineId.slice(0, 8)}… · {i.instanceId}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`st ${i.status === "ok" ? "ok" : "off"}`}>
                        <i />
                        {i.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="r">
                      {i.status !== "revoked" && (
                        <button
                          className="btn danger"
                          style={{ padding: "4px 10px", fontSize: 11 }}
                          onClick={async () => {
                            if (confirm(`Revoke ${i.hostname}?`)) {
                              await api.revoke(i.id);
                              fleet.reload();
                            }
                          }}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {enrolled.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty">No enrolled instances yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

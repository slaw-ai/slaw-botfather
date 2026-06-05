import { api } from "../api.ts";
import { useFetch } from "../useFetch.ts";
import { ThemeButton } from "../Shell.tsx";

const sevPill: Record<string, string> = { critical: "crit", warning: "warn", info: "info" };

function rel(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function Alerts() {
  const active = useFetch(() => api.alerts("active"), [], 15_000);
  const resolved = useFetch(() => api.alerts("resolved"), [], 30_000);

  const ack = async (id: string) => {
    await api.acknowledgeAlert(id);
    active.reload();
  };

  return (
    <>
      <div className="topbar">
        <h1>Alerts</h1>
        <span className="crumb">{active.data?.alerts.length ?? 0} active</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span className="pill info">DASHBOARD ONLY</span>
          <ThemeButton />
          <div className="avatar">FZ</div>
        </div>
      </div>

      <div className="content">
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-h">
            <h2>Active</h2>
          </div>
          {active.loading ? (
            <div className="loading">loading…</div>
          ) : active.data?.alerts.length === 0 ? (
            <div className="empty">No active alerts. Fleet is healthy.</div>
          ) : (
            active.data!.alerts.map((a) => (
              <div className="al" key={a.id}>
                <span className={`pill ${sevPill[a.severity]}`} style={{ marginTop: 1 }}>
                  {a.severity.toUpperCase()}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="t">
                    <b>{a.title}</b>
                  </div>
                  <div className="m">{a.detail}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <span className="m">{rel(a.firstSeenAt)}</span>
                  <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => ack(a.id)}>
                    Acknowledge
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2>Resolved</h2>
          </div>
          {resolved.data?.alerts.length === 0 ? (
            <div className="empty">Nothing resolved recently.</div>
          ) : (
            (resolved.data?.alerts ?? []).slice(0, 20).map((a) => (
              <div className="al" key={a.id} style={{ opacity: 0.65 }}>
                <span className="pill dim" style={{ marginTop: 1 }}>RESOLVED</span>
                <div style={{ flex: 1 }}>
                  <div className="t">
                    <b>{a.title}</b>
                  </div>
                  <div className="m">{a.detail}</div>
                </div>
                <span className="m">{rel(a.firstSeenAt)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

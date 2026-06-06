import { useParams, Link, useNavigate } from "react-router-dom";
import { api, money } from "../api.ts";
import { useFetch } from "../useFetch.ts";
import { ThemeButton } from "../Shell.tsx";

export function InstanceDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { data, loading, reload } = useFetch(() => api.instance(id), [id], 15_000);

  if (loading) return <div className="loading">loading instance…</div>;
  if (!data) return <div className="empty">Instance not found.</div>;

  const { instance, squads, costByModelMtd } = data;
  const maxModel = Math.max(1, ...costByModelMtd.map((m) => m.costCents));

  const revoke = async () => {
    if (!confirm(`Revoke ${instance.hostname}? Its API key dies immediately.`)) return;
    await api.revoke(id);
    reload();
  };

  return (
    <>
      <div className="topbar">
        <span className="crumb">
          <Link to="/fleet">Fleet</Link> /
        </span>
        <h1>
          {instance.hostname} · {instance.instanceId}
        </h1>
        <span className={`st ${instance.status === "ok" ? "ok" : "off"}`}>
          <i />
          {instance.status.toUpperCase()}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn danger" onClick={revoke}>
            Revoke
          </button>
          <ThemeButton />
        </div>
      </div>

      <div className="content">
        <div className="kpis c4">
          <div className="kpi">
            <div className="lbl">Squads</div>
            <div className="val">{squads.length}</div>
          </div>
          <div className="kpi">
            <div className="lbl">Spend Today</div>
            <div className="val">{money(instance.spendTodayCents)}</div>
          </div>
          <div className="kpi">
            <div className="lbl">Spend MTD</div>
            <div className="val">{money(instance.spendMtdCents)}</div>
          </div>
          <div className="kpi">
            <div className="lbl">SLAW Version</div>
            <div className="val" style={{ fontSize: 18 }}>{instance.slawVersion}</div>
            <div className="sub mono" style={{ fontSize: 10 }}>{(instance.machineId ?? "").slice(0, 18)}…</div>
          </div>
        </div>

        <div className="row cols-2-1" style={{ display: "grid", gap: 12 }}>
          <div className="panel">
            <div className="panel-h">
              <h2>Squads</h2>
            </div>
            {squads.length === 0 ? (
              <div className="empty">No squads reported yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Squad</th>
                    <th>Status</th>
                    <th className="r">Spent MTD</th>
                    <th>Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {squads.map((s) => {
                    const pct = s.budgetMonthlyCents ? Math.round((s.spentMonthlyCents / s.budgetMonthlyCents) * 100) : 0;
                    const cls = pct >= 100 ? "c" : pct >= 80 ? "w" : "";
                    return (
                      <tr key={s.id}>
                        <td>
                          <b>{s.name}</b>
                        </td>
                        <td className="muted">{s.status}</td>
                        <td className="r mono">{money(s.spentMonthlyCents)}</td>
                        <td>
                          <span className="budget">
                            <i className={cls} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </span>
                          <span className="mono" style={{ fontSize: 10 }}>
                            {s.budgetMonthlyCents ? `${pct}%` : "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2>Cost by Model — MTD</h2>
            </div>
            <div className="hbars">
              {costByModelMtd.length === 0 ? (
                <div className="empty">No cost facts yet.</div>
              ) : (
                costByModelMtd.map((m) => (
                  <div className="hbar" key={m.model}>
                    <span>{m.model}</span>
                    <span className="trk">
                      <i style={{ width: `${(m.costCents / maxModel) * 100}%` }} />
                    </span>
                    <span className="v">{money(m.costCents)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <button className="btn ghost" onClick={() => nav("/fleet")}>
            ← Back to fleet
          </button>
        </div>
      </div>
    </>
  );
}

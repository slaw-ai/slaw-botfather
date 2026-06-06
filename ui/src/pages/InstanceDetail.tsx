import { useParams, Link, useNavigate } from "react-router-dom";
import { api, money, compact } from "../api.ts";
import { useFetch } from "../useFetch.ts";
import { ThemeButton } from "../Shell.tsx";

const EMPTY_TOKENS = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  events: 0,
  subscriptionDominant: false,
};

export function InstanceDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { data, loading, reload } = useFetch(() => api.instance(id), [id], 15_000);

  if (loading) return <div className="loading">loading instance…</div>;
  if (!data) return <div className="empty">Instance not found.</div>;

  const { instance } = data;
  const squads = data.squads ?? [];
  const costByModelMtd = data.costByModelMtd ?? [];
  const tok = data.tokensMtd ?? EMPTY_TOKENS;
  const cachedPct =
    tok.inputTokens + tok.cachedInputTokens > 0
      ? Math.round((tok.cachedInputTokens / (tok.inputTokens + tok.cachedInputTokens)) * 100)
      : 0;
  // Under a subscription (cost ~$0) weight the model bars by tokens, not dollars.
  const modelTokens = (m: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number }) =>
    (Number(m.inputTokens) || 0) + (Number(m.cachedInputTokens) || 0) + (Number(m.outputTokens) || 0);
  const weighByTokens = tok.subscriptionDominant;
  const maxModel = Math.max(
    1,
    ...costByModelMtd.map((m) => (weighByTokens ? modelTokens(m) : Number(m.costCents) || 0)),
  );

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
        <div className="kpis c6">
          <div className="kpi">
            <div className="lbl">Squads</div>
            <div className="val">{squads.length}</div>
          </div>
          <div className="kpi">
            <div className="lbl">Spend MTD</div>
            <div className="val">{money(instance.spendMtdCents)}</div>
            <div className="sub">
              {tok.subscriptionDominant ? (
                <span className="pill info">SUBSCRIPTION</span>
              ) : (
                `${money(instance.spendTodayCents)} today`
              )}
            </div>
          </div>
          <div className="kpi">
            <div className="lbl">Tokens MTD</div>
            <div className="val">{compact(tok.totalTokens)}</div>
            <div className="sub">{tok.events.toLocaleString()} events</div>
          </div>
          <div className="kpi">
            <div className="lbl">Input Tokens</div>
            <div className="val">{compact(tok.inputTokens)}</div>
            <div className="sub">{cachedPct}% cached</div>
          </div>
          <div className="kpi">
            <div className="lbl">Output Tokens</div>
            <div className="val">{compact(tok.outputTokens)}</div>
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
              <h2>{weighByTokens ? "Tokens by Model — MTD" : "Cost by Model — MTD"}</h2>
            </div>
            <div className="hbars">
              {costByModelMtd.length === 0 ? (
                <div className="empty">No usage yet.</div>
              ) : (
                costByModelMtd.map((m) => {
                  const weight = weighByTokens ? modelTokens(m) : Number(m.costCents) || 0;
                  return (
                    <div className="hbar" key={m.model}>
                      <span>{m.model}</span>
                      <span className="trk">
                        <i style={{ width: `${(weight / maxModel) * 100}%` }} />
                      </span>
                      <span className="v">{weighByTokens ? compact(modelTokens(m)) : money(m.costCents)}</span>
                    </div>
                  );
                })
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

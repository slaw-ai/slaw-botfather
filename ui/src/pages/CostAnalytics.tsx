import { api, money, compact } from "../api.ts";
import { useFetch } from "../useFetch.ts";
import { ThemeButton } from "../Shell.tsx";

export function CostAnalytics() {
  const summary = useFetch(() => api.summary(), [], 30_000);
  const cost = useFetch(() => api.cost(14), [], 30_000);

  const s = summary.data;
  const c = cost.data;
  const maxDay = Math.max(1, ...(c?.byDay.map((d) => d.cost_cents) ?? [1]));
  const maxModel = Math.max(1, ...(c?.byModel.map((m) => m.cost_cents) ?? [1]));

  return (
    <>
      <div className="topbar">
        <h1>Cost Analytics</h1>
        <span className="crumb">network-wide · all instances</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <ThemeButton />
          <div className="avatar">FZ</div>
        </div>
      </div>

      <div className="content">
        <div className="kpis c5">
          <div className="kpi">
            <div className="lbl">Spend MTD</div>
            <div className="val">{s ? money(s.spendMtdCents) : "—"}</div>
          </div>
          <div className="kpi">
            <div className="lbl">Forecast EOM</div>
            <div className="val">{s ? money(s.forecastEomCents) : "—"}</div>
          </div>
          <div className="kpi">
            <div className="lbl">Tokens MTD</div>
            <div className="val">{s ? compact(s.inputTokensMtd + s.outputTokensMtd) : "—"}</div>
          </div>
          <div className="kpi">
            <div className="lbl">Cost / Issue</div>
            <div className="val">{s ? money(s.costPerIssueCents) : "—"}</div>
            <div className="sub">{s?.issuesClosedMtd ?? 0} closed MTD</div>
          </div>
          <div className="kpi">
            <div className="lbl">Cached Input</div>
            <div className="val">
              {s && s.inputTokensMtd + s.cachedInputTokensMtd > 0
                ? `${Math.round((s.cachedInputTokensMtd / (s.inputTokensMtd + s.cachedInputTokensMtd)) * 100)}%`
                : "—"}
            </div>
          </div>
        </div>

        <div className="row cols-2-1" style={{ display: "grid", gap: 12 }}>
          <div className="panel">
            <div className="panel-h">
              <h2>Spend by Day — Last 14 Days</h2>
            </div>
            <div className="chart">
              {(c?.byDay ?? []).map((d) => (
                <div key={d.day} className="bar" style={{ height: `${(d.cost_cents / maxDay) * 100}%` }} title={`${d.day}: ${money(d.cost_cents)}`} />
              ))}
              {!c?.byDay.length && <div className="empty">No cost data in range.</div>}
            </div>
            <div className="legend">
              <span>
                <i style={{ background: "var(--accent)" }} />
                daily spend
              </span>
            </div>
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2>Cost by Model — MTD</h2>
            </div>
            <div className="hbars">
              {(c?.byModel ?? []).map((m) => (
                <div className="hbar" key={m.model}>
                  <span>{m.model}</span>
                  <span className="trk">
                    <i style={{ width: `${(m.cost_cents / maxModel) * 100}%` }} />
                  </span>
                  <span className="v">{money(m.cost_cents)}</span>
                </div>
              ))}
              {!c?.byModel.length && <div className="empty">No model breakdown.</div>}
            </div>
          </div>
        </div>

        <div className="row cols-1-1" style={{ display: "grid", gap: 12 }}>
          <div className="panel">
            <div className="panel-h">
              <h2>Top Burner Instances — MTD</h2>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Instance</th>
                  <th className="r">Tokens</th>
                  <th className="r">Spend</th>
                </tr>
              </thead>
              <tbody>
                {(c?.topInstances ?? []).map((t) => (
                  <tr key={t.instance_id_fk}>
                    <td>
                      <b>{t.hostname}</b> <span className="dim">{t.instance_id}</span>
                    </td>
                    <td className="r mono">{compact(Number(t.tokens))}</td>
                    <td className="r mono">{money(t.cost_cents)}</td>
                  </tr>
                ))}
                {!c?.topInstances.length && (
                  <tr>
                    <td colSpan={3} className="empty">No spend yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2>Top Burner Squads — MTD</h2>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Squad</th>
                  <th>Instance</th>
                  <th className="r">Spend</th>
                </tr>
              </thead>
              <tbody>
                {(c?.topSquads ?? []).map((t, i) => (
                  <tr key={i}>
                    <td>
                      <b>{t.squad_name ?? t.squad_local_id}</b>
                    </td>
                    <td className="dim">{t.hostname}</td>
                    <td className="r mono">{money(t.cost_cents)}</td>
                  </tr>
                ))}
                {!c?.topSquads.length && (
                  <tr>
                    <td colSpan={3} className="empty">No spend yet.</td>
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

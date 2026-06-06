import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api, money, compact, type LimitMode, type LimitInput } from "../api.ts";
import { useFetch } from "../useFetch.ts";
import { ThemeButton } from "../Shell.tsx";

const LIMIT_MODE_PILL: Record<LimitMode, string> = { off: "dim", soft: "warn", hard: "crit" };

const EMPTY_TOKENS = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  events: 0,
  subscriptionDominant: false,
};

const STATUS_PILL: Record<string, string> = {
  in_progress: "info",
  done: "ok",
  closed: "ok",
  completed: "ok",
  cancelled: "dim",
  backlog: "dim",
  todo: "dim",
};

function relTime(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const AGENT_PILL: Record<string, string> = {
  running: "ok",
  active: "ok",
  idle: "dim",
  paused: "warn",
  error: "crit",
  offline: "dim",
};

export function InstanceDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [squadFilter, setSquadFilter] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const { data, loading, reload } = useFetch(() => api.instance(id), [id], 15_000);
  const issuesQuery = useFetch(() => api.instanceIssues(id), [id], 15_000);
  const agentsQuery = useFetch(() => api.instanceAgents(id), [id], 15_000);
  const skillsQuery = useFetch(() => api.instanceSkills(id), [id], 60_000);

  if (loading) return <div className="loading">loading instance…</div>;
  if (!data) return <div className="empty">Instance not found.</div>;

  const allIssues = issuesQuery.data?.issues ?? [];
  const issues = squadFilter ? allIssues.filter((i) => i.squadLocalId === squadFilter) : allIssues;

  const allAgents = agentsQuery.data?.agents ?? [];
  const agentList = squadFilter ? allAgents.filter((a) => a.squadLocalId === squadFilter) : allAgents;
  const agentByLocalId = (lid: string | null) =>
    lid ? allAgents.find((a) => a.localId === lid) ?? null : null;

  const allSkills = skillsQuery.data?.skills ?? [];
  const skills = squadFilter ? allSkills.filter((s) => s.squadLocalId === squadFilter) : allSkills;

  const { instance } = data;
  const squads = data.squads ?? [];
  const agentsBySquad = data.agentsBySquad ?? {};
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

        <LimitsPanel instanceId={id} spendMtdCents={instance.spendMtdCents} />

        <div className="row cols-2-1" style={{ display: "grid", gap: 12 }}>
          <div className="panel">
            <div className="panel-h">
              <h2>Squads</h2>
              <span className="dim" style={{ fontSize: 11 }}>click a squad to filter agents, skills &amp; issues</span>
            </div>
            {squads.length === 0 ? (
              <div className="empty">No squads reported yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Squad</th>
                    <th>Status</th>
                    <th>Agents</th>
                    <th className="r">Spent MTD</th>
                    <th>Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {squads.map((s) => {
                    const pct = s.budgetMonthlyCents ? Math.round((s.spentMonthlyCents / s.budgetMonthlyCents) * 100) : 0;
                    const cls = pct >= 100 ? "c" : pct >= 80 ? "w" : "";
                    const ag = agentsBySquad[s.localId] ?? { total: 0, byStatus: {} };
                    const selected = squadFilter === s.localId;
                    return (
                      <tr
                        key={s.id}
                        className="click"
                        style={selected ? { background: "var(--accent-soft)" } : undefined}
                        onClick={() => setSquadFilter(selected ? null : s.localId)}
                      >
                        <td>
                          <b>{s.name}</b>
                        </td>
                        <td className="muted">{s.status}</td>
                        <td>
                          <span className="mono">{ag.total}</span>
                          {ag.total > 0 && (
                            <span className="dim" style={{ fontSize: 10, marginLeft: 6 }}>
                              {Object.entries(ag.byStatus)
                                .map(([st, n]) => `${n} ${st}`)
                                .join(" · ")}
                            </span>
                          )}
                        </td>
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

        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-h">
            <h2>Issues</h2>
            {squadFilter ? (
              <span className="tag" style={{ cursor: "pointer" }} onClick={() => setSquadFilter(null)}>
                {squads.find((s) => s.localId === squadFilter)?.name ?? squadFilter} ✕
              </span>
            ) : null}
            <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>
              {issues.length}
              {squadFilter ? ` of ${allIssues.length}` : ""} · titles only — work content stays on the instance
            </span>
          </div>
          {issuesQuery.loading ? (
            <div className="loading">loading issues…</div>
          ) : issues.length === 0 ? (
            <div className="empty">
              {squadFilter ? "No issues for the selected squad." : "No issues reported by this instance."}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Title</th>
                  <th>Squad</th>
                  <th>Status</th>
                  <th>Assignee</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={i.localId}>
                    <td className="mono" style={{ fontSize: 11 }}>{i.localId}</td>
                    <td>
                      <b>{i.title}</b>
                    </td>
                    <td>
                      <span className="tag">{i.squadName ?? i.squadLocalId}</span>
                    </td>
                    <td>
                      <span className={`pill ${STATUS_PILL[i.status] ?? "dim"}`}>{i.status}</span>
                    </td>
                    <td className="muted">{i.assigneeAgentLocalId ?? "—"}</td>
                    <td className="dim mono" style={{ fontSize: 11 }}>{relTime(i.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-h">
            <h2>Agents</h2>
            {squadFilter ? (
              <span className="tag" style={{ cursor: "pointer" }} onClick={() => setSquadFilter(null)}>
                {squads.find((s) => s.localId === squadFilter)?.name ?? squadFilter} ✕
              </span>
            ) : null}
            <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>
              {agentList.length}
              {squadFilter ? ` of ${allAgents.length}` : ""} · click an agent to view its instructions &amp; config (read-only)
            </span>
          </div>
          {agentsQuery.loading ? (
            <div className="loading">loading agents…</div>
          ) : agentList.length === 0 ? (
            <div className="empty">
              {squadFilter ? "No agents in the selected squad." : "No agents reported by this instance."}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Role</th>
                  <th>Squad</th>
                  <th>Status</th>
                  <th>Adapter</th>
                  <th className="r">Budget MTD</th>
                </tr>
              </thead>
              <tbody>
                {agentList.map((a) => {
                  const open = openAgent === a.localId;
                  return (
                    <tr
                      key={a.localId}
                      className="click"
                      style={open ? { background: "var(--accent-soft)" } : undefined}
                      onClick={() => setOpenAgent(open ? null : a.localId)}
                    >
                      <td>
                        <b>{a.name}</b>
                        {a.title ? <span className="dim" style={{ fontSize: 11, marginLeft: 6 }}>{a.title}</span> : null}
                      </td>
                      <td className="muted">{a.role}</td>
                      <td>
                        <span className="tag">{a.squadName ?? a.squadLocalId}</span>
                      </td>
                      <td>
                        <span className={`pill ${AGENT_PILL[a.status] ?? "dim"}`}>{a.status}</span>
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>{a.adapterType}</td>
                      <td className="r mono">
                        {a.budgetMonthlyCents != null
                          ? `${money(a.spentMonthlyCents)} / ${money(a.budgetMonthlyCents)}`
                          : money(a.spentMonthlyCents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {openAgent
            ? (() => {
                const a = agentByLocalId(openAgent);
                if (!a) return null;
                const reportsTo = agentByLocalId(a.reportsToLocalId);
                return (
                  <div
                    className="panel"
                    style={{ marginTop: 12, borderColor: "var(--accent)", background: "var(--bg-2, transparent)" }}
                  >
                    <div className="panel-h">
                      <h2 style={{ fontSize: 15 }}>
                        {a.name}
                        {a.title ? <span className="dim" style={{ fontSize: 12, marginLeft: 8 }}>{a.title}</span> : null}
                      </h2>
                      <span className={`pill ${AGENT_PILL[a.status] ?? "dim"}`} style={{ marginLeft: 8 }}>
                        {a.status}
                      </span>
                      <span className="tag" style={{ cursor: "pointer", marginLeft: "auto" }} onClick={() => setOpenAgent(null)}>
                        close ✕
                      </span>
                    </div>
                    <div className="g3" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)", padding: "4px 0 10px" }}>
                      <div>
                        <div className="lbl">Role</div>
                        <div className="mono">{a.role}</div>
                      </div>
                      <div>
                        <div className="lbl">Adapter</div>
                        <div className="mono">{a.adapterType}</div>
                      </div>
                      <div>
                        <div className="lbl">Squad</div>
                        <div>{a.squadName ?? a.squadLocalId}</div>
                      </div>
                      <div>
                        <div className="lbl">Reports to</div>
                        <div>{reportsTo ? reportsTo.name : a.reportsToLocalId ? a.reportsToLocalId : "—"}</div>
                      </div>
                      <div>
                        <div className="lbl">Budget MTD</div>
                        <div className="mono">
                          {a.budgetMonthlyCents != null
                            ? `${money(a.spentMonthlyCents)} / ${money(a.budgetMonthlyCents)}`
                            : money(a.spentMonthlyCents)}
                        </div>
                      </div>
                      <div>
                        <div className="lbl">Updated</div>
                        <div className="dim mono" style={{ fontSize: 12 }}>{relTime(a.updatedAt)} ago</div>
                      </div>
                    </div>
                    <div className="lbl">Instructions</div>
                    {a.capabilities && a.capabilities.trim() ? (
                      <pre
                        className="code"
                        style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto", margin: "4px 0 0", fontSize: 12 }}
                      >
                        {a.capabilities}
                      </pre>
                    ) : (
                      <div className="empty" style={{ marginTop: 4 }}>
                        No instructions reported for this agent.
                      </div>
                    )}
                    <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>
                      Read-only. Adapter credentials &amp; runtime config stay on the instance and are never synced to the tower.
                    </div>
                  </div>
                );
              })()
            : null}
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-h">
            <h2>Skills</h2>
            {squadFilter ? (
              <span className="tag" style={{ cursor: "pointer" }} onClick={() => setSquadFilter(null)}>
                {squads.find((s) => s.localId === squadFilter)?.name ?? squadFilter} ✕
              </span>
            ) : null}
            <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>
              {skills.length}
              {squadFilter ? ` of ${allSkills.length}` : ""} · squad-scoped library · descriptors only
            </span>
          </div>
          {skillsQuery.loading ? (
            <div className="loading">loading skills…</div>
          ) : skills.length === 0 ? (
            <div className="empty">
              {squadFilter ? "No skills in the selected squad." : "No skills reported by this instance."}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Squad</th>
                  <th>Description</th>
                  <th>Source</th>
                  <th>Trust</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((sk) => (
                  <tr key={sk.localId}>
                    <td>
                      <b>{sk.name}</b>
                      <span className="dim mono" style={{ fontSize: 10, marginLeft: 6 }}>{sk.key}</span>
                    </td>
                    <td>
                      <span className="tag">{sk.squadName ?? sk.squadLocalId}</span>
                    </td>
                    <td className="muted" style={{ maxWidth: 360 }}>{sk.description ?? "—"}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{sk.sourceType}</td>
                    <td>
                      <span className={`pill ${sk.trustLevel === "trusted" ? "ok" : "dim"}`}>{sk.trustLevel}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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

const centsToDollars = (c: number | null) => (c == null ? "" : (c / 100).toString());
const dollarsToCents = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/** Read + edit the tower-governed budget limit for this instance (override or inherited). */
function LimitsPanel({ instanceId, spendMtdCents }: { instanceId: string; spendMtdCents: number }) {
  const q = useFetch(() => api.instanceLimits(instanceId), [instanceId], 30_000);
  const [editing, setEditing] = useState(false);
  const [cost, setCost] = useState("");
  const [tokens, setTokens] = useState("");
  const [warn, setWarn] = useState("");
  const [mode, setMode] = useState<LimitMode | "inherit">("inherit");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const ovr = q.data?.override ?? null;
  const eff = q.data?.effective;

  useEffect(() => {
    if (ovr) {
      setCost(centsToDollars(ovr.costLimitCents));
      setTokens(ovr.tokenLimit == null ? "" : String(ovr.tokenLimit));
      setWarn(ovr.warnPercent == null ? "" : String(ovr.warnPercent));
      setMode(ovr.mode ?? "inherit");
    }
  }, [ovr]);

  if (!eff) {
    return (
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-h"><h2>Budget limit</h2></div>
        <div className="loading">loading limit…</div>
      </div>
    );
  }

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const body: LimitInput = {
        costLimitCents: dollarsToCents(cost),
        tokenLimit: numOrNull(tokens),
        warnPercent: warn.trim() === "" ? null : numOrNull(warn),
        mode: mode === "inherit" ? null : mode,
      };
      await api.setInstanceLimits(instanceId, body);
      setMsg("Override saved — pushes to the instance on its next heartbeat.");
      setEditing(false);
      await q.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm("Clear this instance's override? It will revert to the enterprise default.")) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.clearInstanceLimits(instanceId);
      setMsg("Override cleared — reverted to the enterprise default.");
      setEditing(false);
      await q.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setBusy(false);
    }
  };

  const pctCost = eff.costLimitCents && eff.costLimitCents > 0 ? Math.round((spendMtdCents / eff.costLimitCents) * 100) : null;

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-h">
        <h2>Budget limit</h2>
        <span className={`pill ${LIMIT_MODE_PILL[eff.mode]}`} style={{ marginLeft: 8 }}>
          {eff.mode === "off" ? "Off" : eff.mode === "soft" ? "Soft (warn)" : "Hard (block)"}
        </span>
        <span className="tag" style={{ marginLeft: 8, fontSize: 10 }}>{ovr ? "override" : "inherited"}</span>
        <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>
          tower cap · local squad/agent budgets can be stricter
        </span>
      </div>

      <div className="panel-body">
        {!editing ? (
          <>
            <div className="form-grid">
              <div className="field-read">
                <div className="field-cap">Cost ceiling / mo</div>
                <div className="mono">{eff.costLimitCents == null ? "— no cap" : money(eff.costLimitCents)}</div>
                {pctCost != null ? <div className="hint">{money(spendMtdCents)} used · {pctCost}%</div> : null}
              </div>
              <div className="field-read">
                <div className="field-cap">Token ceiling / mo</div>
                <div className="mono">{eff.tokenLimit == null ? "— no cap" : compact(eff.tokenLimit)}</div>
                <div className="hint">Used for subscription runs</div>
              </div>
              <div className="field-read">
                <div className="field-cap">Warn at</div>
                <div className="mono">{eff.warnPercent}%</div>
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => setEditing(true)} disabled={busy}>
                {ovr ? "Edit override" : "Set override"}
              </button>
              {ovr ? (
                <button className="btn ghost" onClick={clear} disabled={busy}>Clear override</button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="form-grid">
              <label className="lbl">
                Cost ceiling / mo (USD)
                <input className="inp" inputMode="decimal" placeholder="inherit / no cap" value={cost} onChange={(e) => setCost(e.target.value)} />
              </label>
              <label className="lbl">
                Token ceiling / mo
                <input className="inp" inputMode="numeric" placeholder="inherit / no cap" value={tokens} onChange={(e) => setTokens(e.target.value)} />
              </label>
              <label className="lbl">
                Warn at %
                <input className="inp" inputMode="numeric" placeholder="inherit" value={warn} onChange={(e) => setWarn(e.target.value)} />
                <span className="hint">Blank = inherit enterprise</span>
              </label>
            </div>
            <div className="form-actions" style={{ marginTop: 16 }}>
              <label className="lbl" style={{ flex: "1 1 220px", maxWidth: 280 }}>
                Enforcement
                <select className="inp" value={mode} onChange={(e) => setMode(e.target.value as LimitMode | "inherit")}>
                  <option value="inherit">Inherit enterprise</option>
                  <option value="off">Off</option>
                  <option value="soft">Soft — warn</option>
                  <option value="hard">Hard — block</option>
                </select>
              </label>
              <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save override"}</button>
              <button className="btn ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            </div>
          </>
        )}
        {msg && <p className="dim" style={{ fontSize: 12, marginTop: 12 }}>{msg}</p>}
      </div>
    </div>
  );
}

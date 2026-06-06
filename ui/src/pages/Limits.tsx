import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  money,
  compact,
  parseDollarsToCents,
  formatCentsToInput,
  parseTokenInput,
  formatTokensToInput,
  type LimitMode,
  type LimitInput,
} from "../api.ts";
import { useFetch } from "../useFetch.ts";
import { ThemeButton } from "../Shell.tsx";

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};
const MODE_PILL: Record<LimitMode, string> = { off: "dim", soft: "warn", hard: "crit" };

function modeLabel(m: LimitMode) {
  return m === "off" ? "Off" : m === "soft" ? "Soft (warn)" : "Hard (block)";
}

export function Limits() {
  const ent = useFetch(() => api.enterpriseLimits(), [], 30_000);
  const fleet = useFetch(() => api.fleet(), [], 30_000);

  // enterprise form state
  const [cost, setCost] = useState("");
  const [tokens, setTokens] = useState("");
  const [warn, setWarn] = useState("80");
  const [mode, setMode] = useState<LimitMode>("soft");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const e = ent.data?.enterprise;
    if (e) {
      setCost(formatCentsToInput(e.costLimitCents));
      setTokens(formatTokensToInput(e.tokenLimit));
      setWarn(String(e.warnPercent));
      setMode(e.mode);
    }
  }, [ent.data]);

  const saveEnterprise = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const body: LimitInput = {
        costLimitCents: parseDollarsToCents(cost),
        tokenLimit: parseTokenInput(tokens),
        warnPercent: numOrNull(warn) ?? 80,
        mode,
      };
      await api.setEnterpriseLimits(body);
      setMsg("Enterprise default saved — it will propagate to all instances on their next heartbeat.");
      await ent.reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const instances = (fleet.data?.instances ?? []).filter((i) => i.status !== "pending" && i.status !== "rejected");

  return (
    <>
      <div className="topbar">
        <h1>Budgets &amp; Limits</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <ThemeButton />
        </div>
      </div>

      <div className="content">
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-h">
            <h2>Enterprise default</h2>
            <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>
              applies to every instance unless overridden · cost for metered runs, tokens for subscription runs
            </span>
          </div>
          <div className="panel-body">
            <div className="form-grid">
              <label className="lbl">
                Cost ceiling / month (USD)
                <input
                  className="inp"
                  inputMode="decimal"
                  placeholder="e.g. 50,000"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  onBlur={() => setCost(formatCentsToInput(parseDollarsToCents(cost)))}
                />
                <span className="hint">Whole dollars · blank = no cost cap</span>
              </label>
              <label className="lbl">
                Token ceiling / month
                <input
                  className="inp"
                  inputMode="text"
                  placeholder="e.g. 20M"
                  value={tokens}
                  onChange={(e) => setTokens(e.target.value)}
                  onBlur={() => setTokens(formatTokensToInput(parseTokenInput(tokens)))}
                />
                <span className="hint">Accepts 20M / 1.5B · blank = no token cap</span>
              </label>
              <label className="lbl">
                Warn at %
                <input className="inp" inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value)} />
                <span className="hint">Soft alert threshold</span>
              </label>
            </div>
            <div className="form-actions" style={{ marginTop: 16 }}>
              <label className="lbl" style={{ flex: "1 1 240px", maxWidth: 300 }}>
                Enforcement
                <select className="inp" value={mode} onChange={(e) => setMode(e.target.value as LimitMode)}>
                  <option value="off">Off — no limit pushed</option>
                  <option value="soft">Soft — warn &amp; alert, don't block</option>
                  <option value="hard">Hard — block runs at the ceiling</option>
                </select>
              </label>
              <button className="btn" onClick={saveEnterprise} disabled={saving}>
                {saving ? "Saving…" : "Save enterprise default"}
              </button>
              {ent.data?.enterprise ? (
                <span className="dim" style={{ fontSize: 11, paddingBottom: 9 }}>v{ent.data.enterprise.version}</span>
              ) : null}
            </div>
            {msg && <p className="dim" style={{ fontSize: 12, marginTop: 12 }}>{msg}</p>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2>Per-instance limits</h2>
            <span className="dim" style={{ fontSize: 11, marginLeft: "auto" }}>
              tower limit caps the instance; local squad/agent budgets can be stricter
            </span>
          </div>
          {fleet.loading ? (
            <div className="loading">loading instances…</div>
          ) : instances.length === 0 ? (
            <div className="empty">No enrolled instances yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Instance</th>
                  <th>Effective cost cap</th>
                  <th>Effective token cap</th>
                  <th>Mode</th>
                  <th>Spend MTD</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {instances.map((i) => (
                  <LimitRow key={i.id} instanceId={i.id} hostname={i.hostname} spendMtdCents={i.spendMtdCents} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

function LimitRow({
  instanceId,
  hostname,
  spendMtdCents,
}: {
  instanceId: string;
  hostname: string;
  spendMtdCents: number;
}) {
  const q = useFetch(() => api.instanceLimits(instanceId), [instanceId], 30_000);
  const eff = q.data?.effective;
  const overridden = !!q.data?.override;
  if (!eff) {
    return (
      <tr>
        <td>
          <Link to={`/instances/${instanceId}`}>{hostname}</Link>
        </td>
        <td className="dim" colSpan={5}>
          loading…
        </td>
      </tr>
    );
  }
  const pctCost =
    eff.costLimitCents && eff.costLimitCents > 0 ? Math.round((spendMtdCents / eff.costLimitCents) * 100) : null;
  return (
    <tr>
      <td>
        <Link to={`/instances/${instanceId}`}>
          <b>{hostname}</b>
        </Link>
        <span className={`tag`} style={{ marginLeft: 8, fontSize: 10 }}>
          {overridden ? "override" : "inherited"}
        </span>
      </td>
      <td className="mono">{eff.costLimitCents == null ? "—" : money(eff.costLimitCents)}</td>
      <td className="mono">{eff.tokenLimit == null ? "—" : compact(eff.tokenLimit)}</td>
      <td>
        <span className={`pill ${MODE_PILL[eff.mode]}`}>{modeLabel(eff.mode)}</span>
      </td>
      <td className="mono">
        {money(spendMtdCents)}
        {pctCost != null ? <span className="dim" style={{ fontSize: 10, marginLeft: 6 }}>{pctCost}%</span> : null}
      </td>
      <td className="r">
        <Link to={`/instances/${instanceId}`} className="dim" style={{ fontSize: 11 }}>
          edit →
        </Link>
      </td>
    </tr>
  );
}

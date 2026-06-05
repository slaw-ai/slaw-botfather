import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "./api.ts";

function toggleTheme() {
  const el = document.documentElement;
  const light = el.getAttribute("data-theme") === "light";
  if (light) {
    el.removeAttribute("data-theme");
    localStorage.setItem("bf-theme", "dark");
  } else {
    el.setAttribute("data-theme", "light");
    localStorage.setItem("bf-theme", "light");
  }
}

export function ThemeButton() {
  const [light, setLight] = useState(document.documentElement.getAttribute("data-theme") === "light");
  return (
    <button
      className="theme-btn"
      onClick={() => {
        toggleTheme();
        setLight((v) => !v);
      }}
    >
      {light ? "☾" : "☀"}
    </button>
  );
}

export function Shell() {
  const [counts, setCounts] = useState({ alerts: 0, approvals: 0 });
  useEffect(() => {
    const load = () =>
      Promise.all([api.alerts("active").catch(() => ({ alerts: [] })), api.approvals().catch(() => ({ pending: [] }))]).then(
        ([a, p]) => setCounts({ alerts: a.alerts.length, approvals: p.pending.length }),
      );
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const link = (to: string, ico: string, label: string, badge?: number) => (
    <NavLink to={to} className={({ isActive }) => (isActive ? "on" : "")}>
      <span className="ico">{ico}</span> {label}
      {badge ? <span className="badge">{badge}</span> : null}
    </NavLink>
  );

  return (
    <>
      <aside className="side">
        <div className="logo">
          <div className="logo-mark">BF</div>
          <div>
            <b>BOTFATHER</b>
            <span>SLAW Control Tower</span>
          </div>
        </div>
        <div className="nav-sec">Monitor</div>
        <nav className="nav">
          {link("/fleet", "▦", "Fleet")}
          {link("/issues", "◎", "Issues in Flight")}
          {link("/alerts", "⚠", "Alerts", counts.alerts)}
        </nav>
        <div className="nav-sec">Govern</div>
        <nav className="nav">
          {link("/cost", "◫", "Cost Analytics")}
          {link("/admin", "⚿", "Approvals & Admin", counts.approvals)}
        </nav>
        <div className="side-foot">
          <span className="dot">●</span> ingest healthy · v0.1.0
        </div>
      </aside>
      <div className="main">
        <Outlet />
      </div>
    </>
  );
}

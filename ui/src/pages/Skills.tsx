import { useEffect, useMemo, useState } from "react";
import { api, type SkillStatus } from "../api.ts";
import { useFetch } from "../useFetch.ts";
import { ThemeButton } from "../Shell.tsx";

const STATUS_PILL: Record<SkillStatus, string> = {
  draft: "dim",
  published: "ok",
  deprecated: "warn",
};
const TRUST_LEVELS = ["markdown_only", "trusted"];

function slugifyKey(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

type Draft = {
  name: string;
  description: string;
  category: string;
  trustLevel: string;
  markdown: string;
};

const emptyDraft: Draft = { name: "", description: "", category: "", trustLevel: "markdown_only", markdown: "" };

export function Skills() {
  const list = useFetch(() => api.skills(), [], 30_000);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<SkillStatus | "all">("all");

  const skills = list.data?.skills ?? [];
  const catalogVersion = list.data?.catalogVersion ?? 0;

  const visible = useMemo(
    () => (filter === "all" ? skills : skills.filter((s) => s.status === filter)),
    [skills, filter],
  );
  const selected = skills.find((s) => s.key === selectedKey) ?? null;

  // load the selected skill into the editor draft
  useEffect(() => {
    if (selected) {
      setCreating(false);
      setDraft({
        name: selected.name,
        description: selected.description ?? "",
        category: selected.category ?? "",
        trustLevel: selected.trustLevel,
        markdown: selected.markdown,
      });
      setMsg(null);
      setErr(null);
    }
  }, [selectedKey, selected?.updatedAt]);

  const startCreate = () => {
    setCreating(true);
    setSelectedKey(null);
    setNewKey("");
    setDraft(emptyDraft);
    setMsg(null);
    setErr(null);
  };

  const flash = (m: string) => {
    setMsg(m);
    setErr(null);
  };
  const fail = (e: unknown) => {
    setErr(e instanceof Error ? e.message : "Request failed");
    setMsg(null);
  };

  const saveNew = async () => {
    const key = (newKey.trim() || slugifyKey(draft.name)).trim();
    if (!key || !draft.name.trim()) {
      fail(new Error("Key and name are required."));
      return;
    }
    setSaving(true);
    try {
      await api.createSkill({
        key,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        category: draft.category.trim() || null,
        markdown: draft.markdown,
        trustLevel: draft.trustLevel,
      });
      await list.reload();
      setSelectedKey(key);
      setCreating(false);
      flash("Skill created as a draft. Publish it to make it available to the fleet.");
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.updateSkill(selected.key, {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        category: draft.category.trim() || null,
        markdown: draft.markdown,
        trustLevel: draft.trustLevel,
      });
      await list.reload();
      flash(
        selected.status === "published"
          ? "Draft changes saved. Re-publish to push the new version to instances."
          : "Draft saved.",
      );
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const r = await api.publishSkill(selected.key);
      await list.reload();
      flash(
        r.contentChanged
          ? `Published v${r.skill.version}. Instances with this skill installed will refresh on their next sync.`
          : "Already up to date — no content change to publish.",
      );
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const deprecate = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.deprecateSkill(selected.key);
      await list.reload();
      flash("Deprecated — removed from the catalog. Already-installed copies are not uninstalled.");
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const counts = {
    published: skills.filter((s) => s.status === "published").length,
    draft: skills.filter((s) => s.status === "draft").length,
    deprecated: skills.filter((s) => s.status === "deprecated").length,
  };

  return (
    <>
      <div className="topbar">
        <h1>Skill Registry</h1>
        <span className="dim" style={{ fontSize: 11, marginLeft: 14 }}>
          tower-mastered · catalog v{catalogVersion} · {counts.published} published · {counts.draft} draft
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn" onClick={startCreate}>
            + New skill
          </button>
          <ThemeButton />
        </div>
      </div>

      <div className="content">
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
          {/* ── library table ── */}
          <div className="panel">
            <div className="panel-h">
              <h2>Library</h2>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {(["all", "published", "draft", "deprecated"] as const).map((f) => (
                  <button
                    key={f}
                    className={`btn ghost${filter === f ? " on" : ""}`}
                    style={{ padding: "3px 9px", fontSize: 11 }}
                    onClick={() => setFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            {visible.length === 0 ? (
              <div className="empty" style={{ padding: 28 }}>
                {skills.length === 0
                  ? "No skills yet. Create one and publish it to make it available to the fleet."
                  : "No skills match this filter."}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Category</th>
                    <th>Trust</th>
                    <th>Status</th>
                    <th className="r">Ver</th>
                    <th className="r">Adoption</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <tr
                      key={s.key}
                      onClick={() => setSelectedKey(s.key)}
                      className={selectedKey === s.key ? "on" : ""}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <div style={{ fontWeight: 600 }}>{s.name}</div>
                        <div className="dim mono" style={{ fontSize: 10.5 }}>
                          {s.key}
                        </div>
                      </td>
                      <td>{s.category ? <span className="tag">{s.category}</span> : <span className="dim">—</span>}</td>
                      <td>
                        <span className="dim mono" style={{ fontSize: 10.5 }}>
                          {s.trustLevel}
                        </span>
                      </td>
                      <td>
                        <span className={`pill ${STATUS_PILL[s.status]}`}>{s.status}</span>
                      </td>
                      <td className="r mono">{s.version}</td>
                      <td className="r">
                        {s.adoption && s.adoption.squads > 0 ? (
                          <span title={`${s.adoption.squads} squad(s) across ${s.adoption.instances} instance(s)`}>
                            {s.adoption.squads}sq · {s.adoption.instances}in
                          </span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── editor ── */}
          <div className="panel">
            <div className="panel-h">
              <h2>{creating ? "New skill" : selected ? "Edit skill" : "No skill selected"}</h2>
              {selected ? (
                <span className={`pill ${STATUS_PILL[selected.status]}`} style={{ marginLeft: "auto" }}>
                  {selected.status} · v{selected.version}
                </span>
              ) : null}
            </div>
            <div className="panel-body">
              {!creating && !selected ? (
                <div className="empty">Select a skill from the library, or create a new one.</div>
              ) : (
                <>
                  {creating ? (
                    <div style={{ marginBottom: 14 }}>
                      <label className="lbl">Key (stable id)</label>
                      <input
                        className="inp mono"
                        placeholder={draft.name ? slugifyKey(draft.name) : "playwright-e2e"}
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                      />
                      <div className="dim" style={{ fontSize: 10.5, marginTop: 3 }}>
                        Leave blank to derive from the name. Cannot change later.
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginBottom: 14 }}>
                      <span className="field-cap">Key</span>
                      <div className="mono">{selected?.key}</div>
                    </div>
                  )}

                  <div className="form-grid" style={{ marginBottom: 14 }}>
                    <div>
                      <label className="lbl">Name</label>
                      <input className="inp" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                    </div>
                    <div>
                      <label className="lbl">Category</label>
                      <input
                        className="inp"
                        placeholder="testing / frontend / cyber"
                        value={draft.category}
                        onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="lbl">Trust level</label>
                      <select
                        className="inp"
                        value={draft.trustLevel}
                        onChange={(e) => setDraft({ ...draft, trustLevel: e.target.value })}
                      >
                        {TRUST_LEVELS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label className="lbl">Description</label>
                    <input
                      className="inp"
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <label className="lbl">Skill body (markdown)</label>
                    <textarea
                      className="inp mono"
                      style={{ height: "auto", minHeight: 220, resize: "vertical", lineHeight: 1.5 }}
                      value={draft.markdown}
                      onChange={(e) => setDraft({ ...draft, markdown: e.target.value })}
                    />
                  </div>

                  <div className="form-actions">
                    {creating ? (
                      <button className="btn" disabled={saving} onClick={saveNew}>
                        {saving ? "Creating…" : "Create draft"}
                      </button>
                    ) : (
                      <>
                        <button className="btn" disabled={saving} onClick={saveEdit}>
                          {saving ? "Saving…" : "Save draft"}
                        </button>
                        {selected?.status !== "deprecated" ? (
                          <button className="btn" disabled={saving} onClick={publish} style={{ background: "var(--ok)" }}>
                            {selected?.status === "published" ? "Re-publish" : "Publish"}
                          </button>
                        ) : null}
                        {selected?.status === "published" ? (
                          <button className="btn danger" disabled={saving} onClick={deprecate}>
                            Deprecate
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>

                  {selected && selected.adoption && selected.adoption.squads > 0 ? (
                    <div className="dim" style={{ fontSize: 11, marginTop: 12 }}>
                      Installed on {selected.adoption.squads} squad(s) across {selected.adoption.instances} instance(s).
                    </div>
                  ) : null}

                  {msg ? (
                    <div style={{ marginTop: 12, color: "var(--ok)", fontSize: 12 }}>{msg}</div>
                  ) : null}
                  {err ? (
                    <div style={{ marginTop: 12, color: "var(--crit)", fontSize: 12 }}>{err}</div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

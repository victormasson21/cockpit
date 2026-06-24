// App.tsx — app shell: loads settings, renders the themed header (view switcher + new-worktree) and the active view.
import { useEffect, useState } from "react";
import { loadSettings } from "./settings/api";
import { useSettings } from "./settings/store";
import { WorktreesView } from "./views/WorktreesView";
import { CockpitView } from "./views/CockpitView";
import { CalmView } from "./views/CalmView";
import { NewWorktreeModal } from "./views/NewWorktreeModal";
import "./App.css";

type View = "cockpit" | "worktrees" | "calm";
const VIEWS: { id: View; label: string }[] = [
  { id: "cockpit", label: "Cockpit" },
  { id: "worktrees", label: "Worktrees" },
  { id: "calm", label: "Calm" },
];

// normalizeView: map the persisted defaultView (incl. legacy "main") onto a current view id.
function normalizeView(v: string): View {
  return v === "cockpit" || v === "calm" ? v : "worktrees";
}

function App() {
  const { loaded, init, addScratch } = useSettings();
  const [view, setView] = useState<View>("worktrees");
  const [creating, setCreating] = useState<null | "deduce" | "existing">(null);

  // On startup: pull persisted settings from the Rust core, seed the store, pick the saved default view.
  useEffect(() => {
    loadSettings()
      .then((s) => { init(s); setView(normalizeView(s.cockpit.preferences.defaultView)); })
      .catch((e) => console.error("load failed", e));
  }, [init]);

  if (!loaded) return <div className="app__loading">Loading…</div>;

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo" aria-hidden />
          <span className="app__name">cockpit</span>
          <span className="app__version">v0.4</span>
        </div>
        <nav className="app__segmented">
          {VIEWS.map((v) => (
            <button key={v.id} className={`app__seg ${view === v.id ? "app__seg--active" : ""}`} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        <div className="app__actions">
          <button className="app__new" onClick={() => setCreating("deduce")}>+ New worktree</button>
          <button className="app__new" onClick={() => setCreating("existing")}>+ Existing branch</button>
          <button className="app__new" onClick={() => addScratch()}>+ Terminal</button>
        </div>
      </header>
      <main className="app__body">
        {view === "cockpit" && <CockpitView />}
        {view === "worktrees" && <WorktreesView />}
        {view === "calm" && <CalmView />}
      </main>
      {creating && <NewWorktreeModal initialMode={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

export default App;

// App.tsx — app shell: loads settings, renders the themed header (view switcher + new-worktree) and the active view.
import { useEffect, useState } from "react";
import { loadSettings } from "./settings/api";
import { slackInit } from "./tiles/slack/api";
import { useSettings } from "./settings/store";
import { WorktreesView } from "./views/WorktreesView";
import { CockpitView } from "./views/CockpitView";
import { CalmView } from "./views/CalmView";
import { NewWorktreeModal } from "./views/NewWorktreeModal";
import { SettingsModal } from "./views/SettingsModal";
import { MIN_SLOTS, SLOT_COUNT } from "./views/slots";
import { GearIcon } from "./views/icons";
import logoUrl from "./assets/cockpit-radar.svg";
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
  const { loaded, init, slotCount, setSlotCount } = useSettings();
  const worktreeError = useSettings((s) => s.worktreeError);
  const clearWorktreeError = useSettings((s) => s.clearWorktreeError);
  const fontScale = useSettings((s) => s.fontScale);
  const zoomIn = useSettings((s) => s.zoomIn);
  const zoomOut = useSettings((s) => s.zoomOut);
  const resetZoom = useSettings((s) => s.resetZoom);
  const [view, setView] = useState<View>("worktrees");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Push the zoom multiplier onto <html> so every --fs-* token (calc(base * var(--font-scale))) recomputes.
  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(fontScale));
  }, [fontScale]);

  // Global text-zoom shortcuts (the app's first): Cmd/Ctrl +, -, 0. macOS delivers "+" as key "=".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") { e.preventDefault(); zoomIn(); }
      else if (e.key === "-") { e.preventDefault(); zoomOut(); }
      else if (e.key === "0") { e.preventDefault(); resetZoom(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIn, zoomOut, resetZoom]);

  // Cmd/Ctrl+N: open the New modal (browser default is "new window" — preventDefault claims the combo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); setCreating(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // On startup: pull persisted settings from the Rust core, seed the store, pick the saved default view.
  useEffect(() => {
    loadSettings()
      .then((s) => {
        init(s);
        setView(normalizeView(s.cockpit.preferences.defaultView));
        const slack = s.cockpit.integrations?.slack;
        slackInit(slack?.clientId, slack?.watchedChannelIds ?? []).catch(() => {});
      })
      .catch((e) => console.error("load failed", e));
  }, [init]);

  // Reopen the deduce modal (prefilled) when a background deduce/create fails, so the user can retry.
  useEffect(() => {
    if (worktreeError) setCreating(true);
  }, [worktreeError]);

  if (!loaded) return <div className="app__loading">Loading…</div>;

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <img className="app__logo" src={logoUrl} alt="" aria-hidden />
          <span className="app__name">cockpit</span>
        </div>
        <nav className="app__segmented">
          {VIEWS.map((v) => (
            <button key={v.id} className={`app__seg ${view === v.id ? "app__seg--active" : ""}`} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        <div className="app__actions">
          {view !== "cockpit" && (
            // Panes toggle: switch the Worktrees/Calm columns between 2 and 3 (drops/adds the rightmost pane).
            <div className="app__panes" role="group" aria-label="Visible panes">
              {Array.from({ length: SLOT_COUNT - MIN_SLOTS + 1 }, (_, i) => MIN_SLOTS + i).map((n) => (
                <button
                  key={n}
                  className={`app__pane ${slotCount === n ? "app__pane--active" : ""}`}
                  onClick={() => setSlotCount(n)}
                  aria-pressed={slotCount === n}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          <button className="app__new" onClick={() => setCreating(true)}>+ New</button>
          <button className="app__new app__new--icon" aria-label="settings" onClick={() => setSettingsOpen(true)}><GearIcon /></button>
        </div>
      </header>
      <main className="app__body">
        {view === "cockpit" && <CockpitView onOpenSettings={() => setSettingsOpen(true)} />}
        {view === "worktrees" && <WorktreesView />}
        {view === "calm" && <CalmView />}
      </main>
      {creating && <NewWorktreeModal view={view} onClose={() => { setCreating(false); clearWorktreeError(); }} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default App;

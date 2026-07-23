// App.tsx — app shell: loads settings, renders the themed header (view switcher + new-worktree) and the active view.
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { loadSettings } from "./settings/api";
import { versionLabel } from "./version";
import { slackInit } from "./tiles/slack/api";
import { useSettings } from "./settings/store";
import { WorktreesView } from "./views/WorktreesView";
import { CockpitView } from "./views/CockpitView";
import { CalmView } from "./views/CalmView";
import { NewWorktreeModal } from "./views/NewWorktreeModal";
import { SettingsModal } from "./views/SettingsModal";
import { GearIcon } from "./views/icons";
import { HeaderTimer } from "./tiles/timer/HeaderTimer";
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
  const { loaded, init } = useSettings();
  const setCockpitWorktree = useSettings((s) => s.setCockpitWorktree);
  const worktreeError = useSettings((s) => s.worktreeError);
  const clearWorktreeError = useSettings((s) => s.clearWorktreeError);
  const timerRunning = useSettings((s) => s.timerRunning);
  const tickTimer = useSettings((s) => s.tickTimer);
  const fontScale = useSettings((s) => s.fontScale);
  const zoomIn = useSettings((s) => s.zoomIn);
  const zoomOut = useSettings((s) => s.zoomOut);
  const resetZoom = useSettings((s) => s.resetZoom);
  const [view, setView] = useState<View>("worktrees");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // App version for the header tag; import.meta.env.DEV distinguishes local dev from a packaged build.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // Drive the countdown here (App never unmounts), so the timer keeps ticking across view switches.
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(tickTimer, 1000);
    return () => clearInterval(id);
  }, [timerRunning, tickTimer]);

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

  // Cmd/Ctrl+N: open the New modal; Cmd/Ctrl+1..3: switch view (digit order matches the header tabs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "n") { e.preventDefault(); setCreating(true); }
      else {
        const v = VIEWS[Number(e.key) - 1];
        if (v) { e.preventDefault(); setView(v.id); }
      }
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

  // Pin a worktree as the Cockpit view's right column, then jump straight to that view (unpin lives in Cockpit).
  const pinToCockpit = (id: string) => { setCockpitWorktree(id); setView("cockpit"); };

  if (!loaded) return <div className="app__loading">Loading…</div>;

  return (
    <div className="app">
      {/* data-tauri-drag-region: empty header areas drag the window (overlay titlebar); buttons still click. */}
      <header className="app__header" data-tauri-drag-region>
        <div className="app__brand">
          <span className="app__logo" aria-hidden />
          <span className="app__name">cockpit</span>
          <span className="app__version">{versionLabel(version, import.meta.env.DEV)}</span>
        </div>
        <nav className="app__segmented">
          {VIEWS.map((v) => (
            <button key={v.id} className={`app__seg ${view === v.id ? "app__seg--active" : ""}`} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </nav>
        <div className="app__actions">
          <HeaderTimer />
          <button className="app__new" onClick={() => setCreating(true)}>+ New</button>
          <button className="app__new app__new--icon" aria-label="settings" onClick={() => setSettingsOpen(true)}><GearIcon /></button>
        </div>
      </header>
      <main className="app__body">
        {view === "cockpit" && <CockpitView onOpenSettings={() => setSettingsOpen(true)} />}
        {view === "worktrees" && <WorktreesView onPin={pinToCockpit} />}
        {view === "calm" && <CalmView />}
      </main>
      {creating && <NewWorktreeModal view={view} onClose={() => { setCreating(false); clearWorktreeError(); }} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default App;

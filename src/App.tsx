// App.tsx — app shell: loads settings, registers tiles, and renders the dockview workspace with a Main/Calm view toggle.
import { useEffect, useState } from "react";
import { loadSettings } from "./settings/api";
import { useSettings } from "./settings/store";
import { registerBuiltinTiles } from "./tiles";
import { Layout } from "./layout/Layout";

// Register built-in tile kinds once at module load (before any Layout renders).
registerBuiltinTiles();

function App() {
  const { loaded, cockpit, init } = useSettings();
  const [view, setView] = useState<string>("main");

  // On startup: pull persisted settings from the Rust core, seed the store, and pick the saved default view.
  useEffect(() => {
    loadSettings()
      .then((s) => {
        init(s);
        setView(s.cockpit.preferences.defaultView);
      })
      .catch((e) => console.error("load failed", e));
  }, [init]);

  if (!loaded) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ display: "flex", gap: 8, padding: 8, borderBottom: "1px solid #ddd" }}>
        <button onClick={() => setView("main")} disabled={view === "main"}>Main</button>
        <button onClick={() => setView("calm")} disabled={view === "calm"}>Calm</button>
        <span style={{ marginLeft: "auto", opacity: 0.5 }}>{cockpit.tiles.length} tiles</span>
      </div>
      {/* position: relative + flex:1 gives Layout's absolute-inset wrapper a sized, positioned ancestor */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <Layout key={view} view={view} />
      </div>
    </div>
  );
}

export default App;

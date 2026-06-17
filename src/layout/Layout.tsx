// Layout.tsx — renders the dockview workspace for one named view, mapping panels to registered tiles and persisting geometry back to settings.
import {
  DockviewReact,
  themeLight,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
  type SerializedDockview,
} from "dockview";
import "dockview/dist/styles/dockview.css";
import { useSettings } from "../settings/store";
import { getTile } from "../tiles/registry";
import { reconcile } from "../settings/reconcile";
import { UnknownTile } from "./UnknownTile";

// components — panel renderer map; each panel resolves its tile instance from `params.tileId` and falls back to UnknownTile rather than crashing the layout.
const components = {
  tile: (props: IDockviewPanelProps<{ tileId: string }>) => {
    const { cockpit, setCockpit } = useSettings();
    const instance = cockpit.tiles.find((t) => t.id === props.params.tileId);
    if (!instance) return <UnknownTile type="(missing)" />;
    const def = getTile(instance.type);
    if (!def) return <UnknownTile type={instance.type} />;
    const Comp = def.component;
    return (
      <Comp
        id={instance.id}
        config={instance.config}
        updateConfig={(next) =>
          setCockpit({
            ...cockpit,
            tiles: cockpit.tiles.map((t) => (t.id === instance.id ? { ...t, config: next } : t)),
          })
        }
      />
    );
  },
};

export function Layout({ view }: { view: string }) {
  const { cockpit, layout, setView } = useSettings();

  // onReady — restore saved geometry, add any configured-but-unplaced tiles as panels, then persist future layout changes.
  const onReady = (event: DockviewReadyEvent) => {
    const serialized = layout.views[view];
    if (serialized) {
      try {
        event.api.fromJSON(serialized as SerializedDockview);
      } catch {
        /* corrupt/incompatible geometry — start empty */
      }
    }
    const panelIds = event.api.panels
      .map((p) => (p.params as { tileId?: string } | undefined)?.tileId)
      .filter((id): id is string => Boolean(id));
    const { unplacedTiles } = reconcile(cockpit.tiles, panelIds);
    for (const t of unplacedTiles) {
      event.api.addPanel({ id: t.id, component: "tile", title: t.type, params: { tileId: t.id } });
    }
    event.api.onDidLayoutChange(() => setView(view, event.api.toJSON()));
  };

  // theme prop (not a wrapper className) is how dockview 6.x applies its theme; fill the parent so the workspace is visible.
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <DockviewReact components={components} onReady={onReady} theme={themeLight} />
    </div>
  );
}

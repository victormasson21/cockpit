// BackgroundLayer.tsx — the app-wide background: one fixed layer behind every view, holding whichever
// variant the user picked. Renders nothing at all when off, so an unused background costs no DOM.
import { useSettings } from "../settings/store";
import { resolveBackground } from "./registry";
import "./background.css";

export function BackgroundLayer() {
  const variant = resolveBackground(useSettings((s) => s.cockpit.preferences.background));
  if (!variant) return null;
  return <div className="app__bg" aria-hidden>{variant.render()}</div>;
}

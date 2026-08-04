// registry.ts — the catalogue of app backgrounds. Adding a variant = one CSS class + one entry here;
// no component and no consumer changes (the same promise ThemeProvider makes about themes).
import type { ReactElement } from "react";

// The "off" id. Persisted like any other, so choosing off is a deliberate, durable choice rather
// than an absent field that a future default could silently override.
export const NO_BACKGROUND = "none";

export interface BackgroundVariant {
  id: string;
  label: string; // shown in the Settings picker
  render: () => ReactElement;
}

// Each variant owns its own artwork: it renders whatever elements it needs inside the layer, and its
// colours live in its own stylesheet (backgrounds ARE colour, so variant CSS is a literal-colour site
// like deepSlate.css and TERM_THEME — the app-wide token rule does not bind them).
export const BACKGROUNDS: BackgroundVariant[] = [
  // Deliberately garish and static: this exists to prove the layer reaches behind every view.
  // It is not a design — the animated variants replace it.
  { id: "pink-test", label: "Pink (test)", render: () => <div className="bg-pink-test" /> },
];

// Which variant to render for a persisted id. Returns null for "off" — and for an id we no longer
// ship, which is the case that matters: a cockpit.json naming a deleted variant must fall back to a
// blank ground, never blank the app or throw.
export function resolveBackground(id: string | undefined): BackgroundVariant | null {
  if (!id || id === NO_BACKGROUND) return null;
  return BACKGROUNDS.find((b) => b.id === id) ?? null;
}

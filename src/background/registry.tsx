// registry.ts — the catalogue of app backgrounds. Adding a variant = one CSS class + one entry here;
// no component and no consumer changes (the same promise ThemeProvider makes about themes).
import type { ReactElement } from "react";
import { NightSky } from "./nightSky";
import { LondonMap } from "./londonMap";

// The "off" id. Persisted like any other, so choosing off is a deliberate, durable choice rather
// than an absent field that a future default could silently override.
export const NO_BACKGROUND = "none";

export interface BackgroundVariant {
  id: string;
  label: string; // shown in the Settings picker
  render: () => ReactElement;
  // Variants built from third-party open data whose licence requires credit carry it here. A
  // background has nowhere to display it, so the Settings picker shows it instead.
  attribution?: string;
}

// Each variant owns its own artwork: it renders whatever elements it needs inside the layer, and its
// colours live in its own stylesheet (backgrounds ARE colour, so variant CSS is a literal-colour site
// like deepSlate.css and TERM_THEME — the app-wide token rule does not bind them).
export const BACKGROUNDS: BackgroundVariant[] = [
  { id: "night-sky", label: "Night sky", render: () => <NightSky /> },
  {
    id: "london-map",
    label: "London map",
    render: () => <LondonMap />,
    attribution:
      "Powered by TfL Open Data. Contains OS data © Crown copyright and database rights. "
      + "Map data © OpenStreetMap contributors, available under the Open Database Licence.",
  },
];

// What an install with no stored choice gets. Kept separate from "the first entry" so reordering the
// list above is a purely cosmetic change to the picker.
export const DEFAULT_BACKGROUND = "night-sky";

// Which variant to render for a persisted id. An explicit NO_BACKGROUND is the ONLY way to get no
// background: anything else we can't resolve — absent, empty, or an id we no longer ship — means "no
// valid stored choice", which is the same situation as a fresh install, so it gets the default. A
// cockpit.json naming a deleted variant therefore degrades to the default rather than a blank ground.
export function resolveBackground(id: string | undefined): BackgroundVariant | null {
  if (id === NO_BACKGROUND) return null;
  return BACKGROUNDS.find((b) => b.id === id)
    ?? BACKGROUNDS.find((b) => b.id === DEFAULT_BACKGROUND)
    ?? null;
}

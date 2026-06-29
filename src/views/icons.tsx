// icons.tsx — shared inline-SVG control glyphs (restart / chevron / gear / close / teardown-menu set).
// Why SVG over unicode glyphs: a path centred in a square viewBox sits dead-centre of the box,
// so flex-centring a button yields pixel-perfect centring — unlike text glyphs whose ink is
// offset by font metrics. They scale with the button's font-size (1em) and tint via currentColor.
import type { CSSProperties } from "react";

const base = {
  width: "1em", height: "1em", display: "block", // block: drop the inline baseline gap so flex centres it
  fill: "none", stroke: "currentColor", strokeWidth: 1.6,
  strokeLinecap: "round", strokeLinejoin: "round",
} as const;

export function RestartIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M12.7 8a4.7 4.7 0 1 1-1.4-3.35" />
      <path d="M12.8 2.4V5.1H10.1" />
    </svg>
  );
}

// open → chevron points down (collapse); closed → rotate to point right (expand).
export function ChevronIcon({ open }: { open: boolean }) {
  const style: CSSProperties = { transform: open ? "none" : "rotate(-90deg)" };
  return (
    <svg viewBox="0 0 16 16" {...base} style={style} aria-hidden="true">
      <path d="M4 6.5 8 10.5l4-4" />
    </svg>
  );
}

// A true cog: a toothed gear ring + centre hub. (The previous path was an 8-ray sun, not a gear.)
export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={1.6} aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

// Pause: two vertical bars (used for the Pause menu action).
export function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M5.5 3.5v9M10.5 3.5v9" />
    </svg>
  );
}

// Bin / trash: lid + can + two ribs (Delete action).
export function BinIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M2.5 4.5h11" />
      <path d="M6 4.5V3h4v1.5" />
      <path d="M4 4.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4.5" />
      <path d="M6.7 7v4M9.3 7v4" />
    </svg>
  );
}

// Broom: diagonal handle into a flared brush head with bristles (Wipe — sweeps the branch away too).
export function BroomIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M13.5 2.5 7 9" />
      <path d="M8.2 7.3 4 11.5l.6 1.8 6-2.4z" />
      <path d="M5.2 12.2l.4 1.3M7 11.5l.4 1.4M8.8 10.8l.4 1.3" />
    </svg>
  );
}

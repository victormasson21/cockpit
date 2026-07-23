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

// Expand: two chevrons pointing apart (grow this pane, collapse its siblings).
export function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M4 5.5 8 1.5l4 4" />
      <path d="M4 10.5 8 14.5l4-4" />
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

// Ghost: domed body with a wavy hem + two eyes (Wipe — the worktree and branch vanish without a trace).
export function GhostIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M3.2 13V7.5a4.8 4.8 0 0 1 9.6 0V13l-1.6-1.2L9.6 13 8 11.8 6.4 13 4.8 11.8z" />
      <path d="M6.3 7h.01M9.7 7h.01" />
    </svg>
  );
}

// Copy: front sheet + peeking back sheet (copy-prompt action on the claude pane).
export function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <rect x="6" y="6" width="7.5" height="7.5" rx="1.5" />
      <path d="M3.5 10.5A1.5 1.5 0 0 1 2 9V4a2 2 0 0 1 2-2h5a1.5 1.5 0 0 1 1.5 1.5" />
    </svg>
  );
}

// Tick: selected-row marker in the themed Dropdown popover.
export function TickIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

// Play: triangle (Run — start the worktree's localhost dev server).
export function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M5.5 3.5v9l7-4.5z" />
    </svg>
  );
}

// Plus: add an extra terminal pane in the worktree.
export function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

// Swap: two horizontal arrows (top → right, bottom → left) — swap two adjacent panels' positions.
// Geometry fills ~75% of the viewBox so it reads clearly at small button sizes.
export function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={2} aria-hidden="true">
      <path d="M2 7h20" />
      <path d="M17 2l5 5-5 5" />
      <path d="M22 17H2" />
      <path d="M7 12l-5 5 5 5" />
    </svg>
  );
}

// Pin: map-pin (set this worktree as the Cockpit view's right-column worktree).
export function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" {...base} aria-hidden="true">
      <path d="M8 14.5S3.5 9.9 3.5 7a4.5 4.5 0 1 1 9 0c0 2.9-4.5 7.5-4.5 7.5z" />
      <circle cx="8" cy="7" r="1.6" />
    </svg>
  );
}

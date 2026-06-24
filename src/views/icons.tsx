// icons.tsx — shared inline-SVG control glyphs (restart / chevron / gear / close).
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

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" {...base} strokeWidth={1.8} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2.6M12 19.4V22M22 12h-2.6M4.6 12H2M19.07 4.93l-1.84 1.84M6.77 17.23l-1.84 1.84M19.07 19.07l-1.84-1.84M6.77 6.77 4.93 4.93" />
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

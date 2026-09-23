// aurora.tsx — the "aurora" background variant: soft coloured bands drifting slowly across the upper sky.
// Pure CSS motion: no state and no timers, so a hidden window just freezes it with nothing to pile up.
import type { CSSProperties } from "react";
import "./aurora.css";

export interface AuroraBand {
  rgb: string;
  leftVw: number; topVh: number;
  widthVw: number; heightVh: number;
  tiltDeg: number;
  low: number; peak: number;
  duration: number;
  phase: number;
}

export const AURORA_BANDS: readonly AuroraBand[] = [
  { rgb: "70, 230, 150", leftVw: -15, topVh: -4, widthVw: 95, heightVh: 44, tiltDeg: -7, low: 0.2, peak: 0.6, duration: 64, phase: 0.1 },
  { rgb: "60, 200, 210", leftVw: 30, topVh: 6, widthVw: 85, heightVh: 36, tiltDeg: 5, low: 0.1, peak: 0.45, duration: 83, phase: 0.55 },
  { rgb: "120, 245, 170", leftVw: 5, topVh: 18, widthVw: 70, heightVh: 26, tiltDeg: -3, low: 0.05, peak: 0.35, duration: 97, phase: 0.3 },
  { rgb: "150, 100, 230", leftVw: 45, topVh: -8, widthVw: 70, heightVh: 34, tiltDeg: 9, low: 0.05, peak: 0.3, duration: 111, phase: 0.8 },
];

export function bandStyle(b: AuroraBand): CSSProperties {
  return {
    left: `${b.leftVw}vw`, top: `${b.topVh}vh`,
    width: `${b.widthVw}vw`, height: `${b.heightVh}vh`,
    animationDuration: `${b.duration}s`,
    animationDelay: `-${b.phase * b.duration}s`,
    "--rgb": b.rgb,
    "--tilt": `${b.tiltDeg}deg`,
    "--low": String(b.low),
    "--peak": String(b.peak),
  } as CSSProperties;
}

export function Aurora() {
  return (
    <div className="au">
      {AURORA_BANDS.map((b) => <div key={b.rgb} className="au__band" style={bandStyle(b)} />)}
    </div>
  );
}

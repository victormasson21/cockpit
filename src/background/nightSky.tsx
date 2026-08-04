// nightSky.tsx — the "night sky" background variant: white glowing dots, some fixed and slowly
// breathing, some crossing the screen as shooting stars.
//
// The performance shape that matters: JS runs ONLY at a star's birth and death. All motion is one CSS
// animation per element, so the browser drives it on the compositor and the main thread is idle in
// between — no per-frame work behind the live terminals. Each star's glow is a STATIC box-shadow, so it
// rasterises once into that element's layer; only opacity and transform animate.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./nightSky.css";

// ── Configuration ──────────────────────────────────────────────────────────────────────────────────
// Every random element is a [min, max] range. Tune the sky here; nothing else needs to change.
type Range = readonly [min: number, max: number];

export const NIGHT_SKY = {
  fixed: {
    count: 70, // how many exist at once — a death immediately spawns a replacement
    size: [1, 2.6] as Range, // px, the dot itself
    glow: [2, 25] as Range, // px, blur radius of the glow around it
    // Alpha of the glow relative to the dot. A wide halo at a high alpha reads as a headlight rather
    // than a star, so this is the knob to pull down if the big ones look too solid.
    glowAlpha: [0.35, 0.9] as Range,
    peak: [0.35, 1] as Range, // opacity held between the fade in and the fade out
    life: [90, 240] as Range, // seconds from first appearance to fully gone
  },
  shooting: {
    perMinute: 4, // average; each gap is jittered ±50% so they never feel metronomic
    size: [1.4, 2.6] as Range,
    glow: [6, 25] as Range,
    glowAlpha: [0.5, 0.9] as Range,
    peak: [0.6, 1] as Range,
    travel: [45, 90] as Range, // vh of screen crossed before it dies
    duration: [1.1, 2.8] as Range, // seconds to cross
    angle: [100, 165] as Range, // deg of travel: 0 = rightwards, 90 = straight down
    tail: [25, 70] as Range, // px of streak trailing the head
  },
} as const;

// ── Pure star construction (unit-tested; the RNG is injected so tests are deterministic) ────────────

export type Rng = () => number; // contract: [0, 1)

export const pick = (r: Range, rng: Rng): number => r[0] + rng() * (r[1] - r[0]);

export interface FixedStar {
  id: string;
  leftPct: number; topPct: number;
  size: number; glow: number; glowAlpha: number; peak: number;
  life: number;
  age: number; // seconds already elapsed, applied as a negative delay
}

export interface ShootingStar {
  id: string;
  leftPct: number; topPct: number;
  size: number; glow: number; glowAlpha: number; peak: number;
  travel: number; duration: number; angle: number; tail: number;
}

// `age` is what stops the whole sky blooming in unison at launch: a star born with a negative delay is
// already part-way through its life, so the field looks established on the first frame.
export function makeFixedStar(id: string, rng: Rng, cfg = NIGHT_SKY.fixed, aged = true): FixedStar {
  const life = pick(cfg.life, rng);
  return {
    id,
    leftPct: rng() * 100,
    topPct: rng() * 100,
    size: pick(cfg.size, rng),
    glow: pick(cfg.glow, rng),
    glowAlpha: pick(cfg.glowAlpha, rng),
    peak: pick(cfg.peak, rng),
    life,
    age: aged ? rng() * life : 0,
  };
}

// Shooting stars start biased towards the upper screen, so they fall INTO the view rather than out of it.
export function makeShootingStar(id: string, rng: Rng, cfg = NIGHT_SKY.shooting): ShootingStar {
  return {
    id,
    leftPct: rng() * 100,
    topPct: rng() * 40,
    size: pick(cfg.size, rng),
    glow: pick(cfg.glow, rng),
    glowAlpha: pick(cfg.glowAlpha, rng),
    peak: pick(cfg.peak, rng),
    travel: pick(cfg.travel, rng),
    duration: pick(cfg.duration, rng),
    angle: pick(cfg.angle, rng),
    tail: pick(cfg.tail, rng),
  };
}

// Milliseconds until the next shooting star. Jittered ±50% around the average so the rhythm reads as
// natural rather than mechanical.
export function nextShootingGap(perMinute: number, rng: Rng): number {
  return (60_000 / perMinute) * (0.5 + rng());
}

// The models carry numbers; the CSS owns the look. Custom properties are the handoff.
export function fixedStarStyle(s: FixedStar): CSSProperties {
  return {
    left: `${s.leftPct}%`, top: `${s.topPct}%`,
    width: `${s.size}px`, height: `${s.size}px`,
    animationDuration: `${s.life}s`,
    animationDelay: `-${s.age}s`,
    "--peak": String(s.peak),
    "--glow": `${s.glow}px`,
    "--glow-alpha": String(s.glowAlpha),
  } as CSSProperties;
}

export function shootingStarStyle(s: ShootingStar): CSSProperties {
  return {
    left: `${s.leftPct}%`, top: `${s.topPct}%`,
    width: `${s.size}px`, height: `${s.size}px`,
    animationDuration: `${s.duration}s`,
    "--peak": String(s.peak),
    "--glow": `${s.glow}px`,
    "--glow-alpha": String(s.glowAlpha),
    "--angle": `${s.angle}deg`,
    "--travel": `${s.travel}vh`,
    "--tail": `${s.tail}px`,
  } as CSSProperties;
}

// ── Component ──────────────────────────────────────────────────────────────────────────────────────

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// Honours the variant contract's "hold still": the sky becomes a static starfield, no births, no motion.
function useStillSky(): boolean {
  const [still, setStill] = useState(() => window.matchMedia?.(REDUCED_MOTION).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(REDUCED_MOTION);
    if (!mq) return;
    const onChange = () => setStill(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return still;
}

export function NightSky() {
  const still = useStillSky();
  const seq = useRef(0);
  const nextId = () => `s${seq.current++}`;
  // Built once, lazily: re-running this on every render would reshuffle the whole sky.
  const [fixed, setFixed] = useState<FixedStar[]>(() =>
    Array.from({ length: NIGHT_SKY.fixed.count }, () => makeFixedStar(`s${seq.current++}`, Math.random)),
  );
  const [shooting, setShooting] = useState<ShootingStar[]>([]);

  // Each shooting star schedules the next one, so the interval is re-jittered every time.
  useEffect(() => {
    if (still) return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setShooting((prev) => [...prev, makeShootingStar(nextId(), Math.random)]);
        schedule();
      }, nextShootingGap(NIGHT_SKY.shooting.perMinute, Math.random));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [still]);

  return (
    <div className="ns">
      {fixed.map((s) => (
        <div
          key={s.id}
          className={`ns__star${still ? "" : " ns__star--fixed"}`}
          style={fixedStarStyle(s)}
          // A finished life is replaced in place: the population stays constant and the spent element
          // is dropped by React (a new id means a new node, so nothing accumulates).
          onAnimationEnd={() => setFixed((prev) => prev.map((p) => (p.id === s.id ? makeFixedStar(nextId(), Math.random, NIGHT_SKY.fixed, false) : p)))}
        />
      ))}
      {shooting.map((s) => (
        <div
          key={s.id}
          className="ns__star ns__star--shooting"
          style={shootingStarStyle(s)}
          onAnimationEnd={() => setShooting((prev) => prev.filter((p) => p.id !== s.id))}
        />
      ))}
    </div>
  );
}

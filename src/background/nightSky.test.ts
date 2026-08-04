import { describe, it, expect } from "vitest";
import {
  NIGHT_SKY, pick, makeFixedStar, makeShootingStar, nextShootingGap, startXPct, admitShootingStar,
  fixedStarStyle, shootingStarStyle, type Rng,
} from "./nightSky";

// A scripted RNG: each call returns the next value, so every random draw is pinned. Cycles rather than
// running dry, since the factories draw a different number of values each.
const scripted = (...values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length];
};
const always = (v: number): Rng => () => v;

describe("pick", () => {
  it("returns the minimum at 0", () => {
    expect(pick([2, 10], always(0))).toBe(2);
  });
  it("returns the midpoint at 0.5", () => {
    expect(pick([2, 10], always(0.5))).toBe(6);
  });
  // rng() is [0, 1), so the max is approached but never returned — the range is a half-open interval.
  it("approaches but never reaches the maximum", () => {
    expect(pick([2, 10], always(0.999))).toBeCloseTo(9.992);
    expect(pick([2, 10], always(0.999))).toBeLessThan(10);
  });
});

describe("makeFixedStar", () => {
  const cfg = NIGHT_SKY.fixed;

  it("keeps every value inside its configured range", () => {
    // 200 draws on the real RNG: cheap, and it covers the whole interval rather than one scripted point.
    for (let i = 0; i < 200; i++) {
      const s = makeFixedStar(`s${i}`, Math.random);
      expect(s.size).toBeGreaterThanOrEqual(cfg.size[0]);
      expect(s.size).toBeLessThan(cfg.size[1]);
      expect(s.glow).toBeGreaterThanOrEqual(cfg.glow[0]);
      expect(s.glow).toBeLessThan(cfg.glow[1]);
      expect(s.glowAlpha).toBeGreaterThanOrEqual(cfg.glowAlpha[0]);
      expect(s.glowAlpha).toBeLessThan(cfg.glowAlpha[1]);
      expect(s.peak).toBeGreaterThanOrEqual(cfg.peak[0]);
      expect(s.peak).toBeLessThan(cfg.peak[1]);
      expect(s.life).toBeGreaterThanOrEqual(cfg.life[0]);
      expect(s.life).toBeLessThan(cfg.life[1]);
    }
  });

  it("places stars across the whole viewport", () => {
    const s = makeFixedStar("a", always(0.5));
    expect(s.leftPct).toBe(50);
    expect(s.topPct).toBe(50);
  });

  // The staggered start: an aged star is already part-way through its life, so the sky looks
  // established on the first frame instead of blooming in unison.
  it("ages a star into its own lifespan by default", () => {
    const s = makeFixedStar("a", always(0.5));
    expect(s.age).toBeGreaterThan(0);
    expect(s.age).toBeLessThan(s.life);
  });

  it("gives a replacement star no age, so it fades in from nothing", () => {
    expect(makeFixedStar("a", always(0.5), NIGHT_SKY.fixed, false).age).toBe(0);
  });

  it("respects an injected config over the default", () => {
    const s = makeFixedStar("a", always(0), { ...NIGHT_SKY.fixed, size: [9, 10] });
    expect(s.size).toBe(9);
  });

  it("keeps the id it was given", () => {
    expect(makeFixedStar("star-7", Math.random).id).toBe("star-7");
  });
});

describe("makeShootingStar", () => {
  const cfg = NIGHT_SKY.shooting;

  it("keeps every value inside its configured range", () => {
    for (let i = 0; i < 200; i++) {
      const s = makeShootingStar(`s${i}`, Math.random);
      expect(s.travel).toBeGreaterThanOrEqual(cfg.travel[0]);
      expect(s.travel).toBeLessThan(cfg.travel[1]);
      expect(s.duration).toBeGreaterThanOrEqual(cfg.duration[0]);
      expect(s.duration).toBeLessThan(cfg.duration[1]);
      expect(s.angle).toBeGreaterThanOrEqual(cfg.angle[0]);
      expect(s.angle).toBeLessThan(cfg.angle[1]);
      expect(s.tail).toBeGreaterThanOrEqual(cfg.tail[0]);
      expect(s.tail).toBeLessThan(cfg.tail[1]);
    }
  });

  // Biased to the upper screen so they fall INTO view rather than immediately out of it.
  it("starts in the top 40% of the screen", () => {
    for (let i = 0; i < 100; i++) {
      expect(makeShootingStar("a", Math.random).topPct).toBeLessThan(40);
    }
  });

  it("always travels downwards, never up", () => {
    // The angle range must stay inside (0, 180): sin > 0 is the whole point of that bound.
    for (let i = 0; i < 200; i++) {
      const { angle } = makeShootingStar("a", Math.random);
      expect(Math.sin((angle * Math.PI) / 180)).toBeGreaterThan(0);
    }
  });

  // Regression: the original range was 100-165deg, whose cosine is negative throughout — so every
  // streak flew leftwards and the sky had no variety.
  it("produces both leftward and rightward streaks", () => {
    const dxs = Array.from({ length: 300 }, () =>
      Math.cos((makeShootingStar("a", Math.random).angle * Math.PI) / 180));
    expect(dxs.some((dx) => dx < -0.15)).toBe(true);
    expect(dxs.some((dx) => dx > 0.15)).toBe(true);
  });
});

describe("startXPct", () => {
  // Regression: start position used to be uniform across the width, so a leftward star born near the
  // left edge spent most of its life clipped off-screen — the crossings looked rarer than the rate.
  it("starts a leftward streak on the right half", () => {
    expect(startXPct(160, always(0))).toBe(55);
    expect(startXPct(160, always(0.999))).toBeCloseTo(99.955);
  });
  it("starts a rightward streak on the left half", () => {
    expect(startXPct(20, always(0))).toBe(0);
    expect(startXPct(20, always(0.999))).toBeCloseTo(44.955);
  });
  it("puts a near-vertical streak anywhere", () => {
    expect(startXPct(90, always(0.999))).toBeCloseTo(99.9);
  });
  it("gives every streak room to cross: it never starts on the side it is heading for", () => {
    for (let i = 0; i < 300; i++) {
      const s = makeShootingStar("a", Math.random);
      const dx = Math.cos((s.angle * Math.PI) / 180);
      if (dx < -0.15) expect(s.leftPct).toBeGreaterThanOrEqual(55);
      if (dx > 0.15) expect(s.leftPct).toBeLessThan(45);
    }
  });
});

describe("nextShootingGap", () => {
  const cfg = { perMinute: 4, minGap: 0.9 }; // mean gap 15s

  // The defining property of the exponential draw: u = 1 - 1/e maps to exactly the mean.
  it("returns the mean gap at the distribution's midpoint", () => {
    expect(nextShootingGap(cfg, always(1 - 1 / Math.E))).toBeCloseTo(15_000);
  });

  it("scales inversely with the rate", () => {
    expect(nextShootingGap({ perMinute: 1, minGap: 0.9 }, always(1 - 1 / Math.E))).toBeCloseTo(60_000);
  });

  // Poisson gaps are unbounded above — a long lull must be reachable, which the old uniform ±50%
  // jitter could never produce.
  it("can produce a lull far longer than the mean", () => {
    expect(nextShootingGap(cfg, always(0.99))).toBeGreaterThan(60_000);
  });

  // ...and short gaps must be reachable too, so streaks occasionally arrive in pairs.
  it("can produce a gap far shorter than the mean", () => {
    expect(nextShootingGap(cfg, always(0.05))).toBeLessThan(1_000);
  });

  it("never returns less than the configured floor", () => {
    expect(nextShootingGap(cfg, always(0))).toBe(900);
    for (let i = 0; i < 500; i++) {
      expect(nextShootingGap(cfg, Math.random)).toBeGreaterThanOrEqual(900);
    }
  });

  // The rate is the contract: whatever the shape, 4/min must average ~15s. The floor lifts the mean a
  // little, hence the generous tolerance.
  it("averages the configured rate over many draws", () => {
    const n = 20_000;
    let total = 0;
    for (let i = 0; i < n; i++) total += nextShootingGap(cfg, Math.random);
    expect(total / n).toBeGreaterThan(13_000);
    expect(total / n).toBeLessThan(17_000);
  });
});

describe("admitShootingStar", () => {
  const star = (id: string) => makeShootingStar(id, Math.random);

  it("admits a star while there is room", () => {
    expect(admitShootingStar([], star("a"), 3)).toHaveLength(1);
    expect(admitShootingStar([star("a"), star("b")], star("c"), 3)).toHaveLength(3);
  });

  // The backstop against the swarm: a hidden window freezes animations, so deaths stop while births
  // continue. Births are paused on hidden too, but this bounds the symptom whatever the cause.
  it("drops the spawn at the ceiling rather than queueing it", () => {
    const full = [star("a"), star("b"), star("c")];
    expect(admitShootingStar(full, star("d"), 3)).toBe(full); // same array — no re-render either
  });

  it("never exceeds the ceiling however many are offered", () => {
    let live = [] as ReturnType<typeof star>[];
    for (let i = 0; i < 50; i++) live = admitShootingStar(live, star(`s${i}`), 3);
    expect(live).toHaveLength(3);
  });
});

describe("style mapping", () => {
  it("hands the fixed star's lifespan to the animation and its age to a negative delay", () => {
    const style = fixedStarStyle(makeFixedStar("a", scripted(0.5)));
    // life = midpoint of [90, 240] = 165; age = 0.5 * 165 = 82.5
    expect(style.animationDuration).toBe("165s");
    expect(style.animationDelay).toBe("-82.5s");
  });

  it("exposes the glow, its alpha and the peak opacity as custom properties", () => {
    const style = fixedStarStyle(makeFixedStar("a", always(0.5))) as Record<string, string>;
    expect(style["--glow"]).toBe("17px"); // midpoint of [8, 26]
    expect(style["--glow-alpha"]).toBe("0.675"); // midpoint of [0.45, 0.9]
    expect(style["--peak"]).toBe("0.675"); // midpoint of [0.35, 1]
  });

  // The angle needs its unit in the value: the keyframes feed it straight into rotate().
  it("gives the shooting star's angle a deg unit and its travel a vh unit", () => {
    const style = shootingStarStyle(makeShootingStar("a", always(0.5))) as Record<string, string>;
    expect(style["--angle"]).toBe("90deg"); // midpoint of [20, 160]
    expect(style["--travel"]).toBe("67.5vh"); // midpoint of [45, 90]
    expect(style["--tail"]).toBe("47.5px"); // midpoint of [25, 70]
  });
});

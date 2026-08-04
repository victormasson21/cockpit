import { describe, it, expect } from "vitest";
import {
  NIGHT_SKY, pick, makeFixedStar, makeShootingStar, nextShootingGap,
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

  it("travels downwards and to the left or right, never straight up", () => {
    // 100-165deg: 90 is straight down, so the whole range has a downward component.
    for (let i = 0; i < 100; i++) {
      const { angle } = makeShootingStar("a", Math.random);
      expect(Math.sin((angle * Math.PI) / 180)).toBeGreaterThan(0);
    }
  });
});

describe("nextShootingGap", () => {
  it("averages the configured rate", () => {
    // 0.5 + 0.5 = 1x the mean gap; 4/min => 15s.
    expect(nextShootingGap(4, always(0.5))).toBe(15_000);
  });
  it("jitters between half and one-and-a-half times the mean", () => {
    expect(nextShootingGap(4, always(0))).toBe(7_500);
    expect(nextShootingGap(4, always(0.999))).toBeCloseTo(22_485);
  });
  it("scales inversely with the rate", () => {
    expect(nextShootingGap(1, always(0.5))).toBe(60_000);
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
    expect(style["--glow"]).toBe("13.5px"); // midpoint of [2, 25]
    expect(style["--glow-alpha"]).toBe("0.625"); // midpoint of [0.35, 0.9]
    expect(style["--peak"]).toBe("0.675"); // midpoint of [0.35, 1]
  });

  // The angle needs its unit in the value: the keyframes feed it straight into rotate().
  it("gives the shooting star's angle a deg unit and its travel a vh unit", () => {
    const style = shootingStarStyle(makeShootingStar("a", always(0.5))) as Record<string, string>;
    expect(style["--angle"]).toBe("132.5deg"); // midpoint of [100, 165]
    expect(style["--travel"]).toBe("67.5vh"); // midpoint of [45, 90]
    expect(style["--tail"]).toBe("47.5px"); // midpoint of [25, 70]
  });
});

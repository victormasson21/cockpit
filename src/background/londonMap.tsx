// londonMap.tsx — the "London map" background variant: a lines-only geographic map of London (roads,
// the Underground, the Thames), baked to SVG paths at build time.
//
// The performance shape that matters: the geometry is a static import and NOTHING animates except one
// CSS transform on the <svg> itself, so the map rasterises once into a single composited layer and the
// main thread stays idle behind the live terminals. One <path> per class is what keeps the whole tree
// at 14 elements — 8 <path>s, plus the <svg>, two groups and the three-node filter — rather than the
// ~13,600 ways OSM actually returns.
import { LONDON_MAP } from "./londonMap.data";
import "./londonMap.css";

const { width, height, layers } = LONDON_MAP;

// Painted back to front: the dimmest substrate first, the tube last so it reads as the map's subject —
// which it is, being the layer that will carry live trains.
const ORDER = ["secondary", "primary", "motorway", "thames", "tube"] as const;

// Only the major classes get a halo. A glow under every secondary road is mush to look at, and the
// blurred copy is the expensive half of rasterising the layer.
const GLOWING = new Set<(typeof ORDER)[number]>(["primary", "motorway", "tube"]);

const GLOW_FILTER = "lm-glow-blur";

// The blur radius is in USER units (the viewBox's 2000x1246 pixel space) — NOT device pixels, which is
// what the stroke widths are, because `vector-effect: non-scaling-stroke` pins those. The viewBox is
// scaled to fit the window, so the halo's size relative to its stroke drifts with window size: the
// ratio is only exactly right at whatever window it was tuned in. At a typical fit factor of ~0.8,
// 4 user units reads as roughly 3 device pixels.
const GLOW_BLUR = 4;

// The filter region is PINNED to the frame, and must stay pinned. An SVG/CSS filter's default region
// derives from the OBJECT BOUNDING BOX, and this group's bbox is nowhere near the frame: the full tube
// network is baked so trains can sail off-frame (spec §7) and is only clipped by the viewport at
// render, so `tube` alone spans ~5700x3200 user units — about 7x the frame's area, which WebKit may
// clamp, or drop the filter over entirely. A `clip-path` would NOT help: clipping happens after
// filtering. Hence an explicit userSpaceOnUse region here rather than a one-line `filter: blur()` in
// the stylesheet. The margin is 6 sigma — a Gaussian is spent by 3, so this is deliberately generous;
// it costs ~24 user units of surface on each edge and guarantees no halo is clipped at the frame.
const GLOW_MARGIN = 6 * GLOW_BLUR;

export function LondonMap() {
  return (
    // `slice` is `cover` with no CSS involved: the frame fills the window and the surplus is cropped.
    <svg className="lm" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        {/* sRGB explicitly: SVG filters default to linearRGB, which blurs white far brighter than CSS
            `filter: blur()` does, so the stroke opacities would no longer mean what they did. */}
        <filter
          id={GLOW_FILTER}
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
          x={-GLOW_MARGIN}
          y={-GLOW_MARGIN}
          width={width + 2 * GLOW_MARGIN}
          height={height + 2 * GLOW_MARGIN}
        >
          <feGaussianBlur stdDeviation={GLOW_BLUR} />
        </filter>
      </defs>
      <g className="lm__glow" filter={`url(#${GLOW_FILTER})`}>
        {ORDER.filter((k) => GLOWING.has(k)).map((k) => (
          <path key={k} className={`lm__line lm__line--${k}`} d={layers[k]} />
        ))}
      </g>
      {ORDER.filter((k) => k !== "tube").map((k) => (
        <path key={k} className={`lm__line lm__line--${k}`} d={layers[k]} />
      ))}
      {/* The tube gets its own <g> (spec §7) so the vehicles step adds trains as siblings above the
          strokes with no restructuring. Last in the tree, so it still paints on top. */}
      <g className="lm__tube">
        {/* One <path> for the whole network, and that is currently hiding a hazard: the bake dedupes
            whole station SEQUENCES, so a line's branches redraw their shared trunk — 452 station
            placements over 272 distinct stations, ~10 deep on the Northern line's core. Compositing
            one element's opacity once is what makes that invisible. SPLIT THIS PER LINE (for colours,
            hover, or per-line trains) AND EVERY TRUNK JUMPS TO ~10x BRIGHTNESS — dedupe overlapping
            trunk segments in the bake first. */}
        <path className="lm__line lm__line--tube" d={layers.tube} />
      </g>
    </svg>
  );
}

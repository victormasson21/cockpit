// londonMap.tsx — the "London map" background variant: a lines-only geographic map of London (roads,
// the Underground, the Thames), baked to SVG paths at build time.
//
// The performance shape that matters: the geometry is a static import and NOTHING animates except one
// CSS transform on the <svg> itself, so the map rasterises once into a single composited layer and the
// main thread stays idle behind the live terminals. One <path> per class is what keeps this at seven
// DOM nodes rather than the ~13,600 ways OSM actually returns.
import { LONDON_MAP } from "./londonMap.data";
import "./londonMap.css";

const { width, height, layers } = LONDON_MAP;

// Painted back to front: the dimmest substrate first, the tube last so it reads as the map's subject —
// which it is, being the layer that will carry live trains.
const ORDER = ["secondary", "primary", "motorway", "thames", "tube"] as const;

// Only the major classes get a halo. A glow under every secondary road is mush to look at, and the
// blurred copy is the expensive half of rasterising the layer.
const GLOWING = new Set<(typeof ORDER)[number]>(["primary", "motorway", "tube"]);

export function LondonMap() {
  return (
    // `slice` is `cover` with no CSS involved: the frame fills the window and the surplus is cropped.
    <svg className="lm" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <g className="lm__glow">
        {ORDER.filter((k) => GLOWING.has(k)).map((k) => (
          <path key={k} className={`lm__line lm__line--${k}`} d={layers[k]} />
        ))}
      </g>
      {ORDER.map((k) => (
        <path key={k} className={`lm__line lm__line--${k}`} d={layers[k]} />
      ))}
    </svg>
  );
}

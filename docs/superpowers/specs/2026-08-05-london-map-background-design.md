# London map background — design

A second background variant alongside Night Sky: a minimal, lines-only **geographic** map of London,
white strokes with a slight glow, read against the existing dark ground.

Scope is **map only**. Live Underground trains are a designed-for second step and are explicitly not
built here — but every decision below that they touch is made in their favour, and §7 lists what this
design guarantees them.

---

## 1. Why geographic, not schematic

TfL's API returns lat/lon, so a geographic map is self-serviceable from open data. The Beck diagram is
not: its coordinates aren't in the API, and the design itself is trademarked even though the underlying
data is openly licensed.

Geographic is also the better look here. At background scale an angular schematic reads as UI chrome
competing with the app; an organic street network reads as texture.

## 2. What's drawn

| Layer | Source | Notes |
|-------|--------|-------|
| Motorway / trunk / primary roads | OSM (Overpass) | includes `*_link` slip roads. **As built, this is TWO tiers, not three:** the `motorway` tier returns zero ways inside the §3 bbox (the M4 and M1 both start outside it), so it bakes to an empty string and renders an empty `<path>`. It stays wired for a wider box; nothing visible depends on it. |
| Secondary roads | OSM (Overpass) | |
| Tertiary roads | OSM (Overpass) | the floor — nothing smaller. Added after seeing the map without it: the tiers above alone read as a sparse skeleton, not a city. This is the texture layer, and most of the byte budget. |
| Tube lines | TfL Unified API | all lines, geographic; the bright layer |
| Rivers and docks | OSM (Overpass) | the real **bank polygons**, filled — not a centreline. The Thames therefore widens towards the estuary and the Isle of Dogs loop reads properly, which is most of what makes the map legible as London. Picks up the Lea, the Wandle and the docks too, hence the layer is `water`, not `thames`. |

**Not** drawn: trains, station markers, labels, parks, other water, buildings, residential roads,
DLR / Overground / Elizabeth line. Station *coordinates* are baked regardless (§7) but nothing
renders them in this scope — at this scale they'd read as noise, and the tube strokes already imply them.

## 3. Bounding box

Landmark-defined, then squared up towards the window's aspect ratio:

| Edge | Landmark | Degrees |
|------|----------|---------|
| west | Turnham Green | −0.2549 |
| east | London City Airport | +0.0495 |
| south | Clapham Common, extended ~1.5 km | 51.448 |
| north | Drayton Park, extended ~1.5 km | 51.566 |

That's ~21 × 13 km ≈ **1.6:1**. The raw landmark box is 2.1:1, and because the layer is full-viewport
under `cover` framing, the *width* gets cropped first — which would have cut Turnham Green and City
Airport, the very edges chosen. The north/south extension (to roughly Finsbury Park and Balham) brings
the box near the window's own ratio so all four landmarks sit just inside the frame at normal sizes.

## 4. Visual design

The variant paints **lines over nothing** — no ground of its own. `.app__bg` already sits above body's
`--bg-0`, so the existing dark blue shows through untouched. Every layer is a stroke except `water`,
which is filled (§2), and every layer is white except `water`, which is tinted from the accent family.

**Glow is a two-layer stroke, never `box-shadow`.** The Night Sky iteration established why: a shadow's
blur leaves the shape's own area fully opaque and only softens outwards, which reads as a hard core with
a soft rim. For strokes the correct idiom is a duplicated stroke group, **genuinely wider than the crisp
one**, blurred, with the crisp stroke painted on top. "Slight" then becomes one tunable.

Two as-built corrections to that sentence, both load-bearing:

- **The extra width is not optional.** Blur conserves total alpha, so re-blurring a stroke at its own
  width just dims it — spreading 1px over ~6px costs roughly a factor of 6 in peak alpha, which on this
  dark ground is the difference between a halo and nothing. The glow group therefore sets its own
  `stroke-width`, and the group opacity is balanced against that width, not against the crisp widths.
- **The blur is an SVG `<filter>`, not CSS `filter: blur()`.** A CSS filter derives its region from the
  *object bounding box*, and the glow group's bbox is ~7× the frame because the full tube network is
  baked (§7) — enough surface for WebKit to clamp or drop the filter outright. See §7 for why clipping
  does not help. The `<filter>` pins an explicit `userSpaceOnUse` region to the frame instead.

The glow layer covers **major classes only** — tube, motorway, trunk/primary. Glowing every secondary
road is both mush to look at and the expensive half of rasterisation.

Starting values, to tune by eye on first render:

| Class | Width | Opacity | Glow |
|-------|-------|---------|------|
| Tertiary | 0.5px | 0.07 | no |
| Secondary | 0.6px | 0.10 | no |
| Primary / trunk | 1.0px | 0.18 | faint |
| Motorway | 1.4px | 0.26 | yes — but paints nothing (§2) |
| Tube | 1.2px | 0.45 | yes |
| Water | *filled*, `evenodd` | 0.22 | no |

The tube being the brightest layer is deliberate: it's the layer that will carry trains, so it should
already read as the map's subject.

**Motion:** a very slow drift of the whole group, so it breathes rather than sitting dead. One transform
on one element. Amplitude stays inside the `cover` overflow margin so no edge is ever exposed.

Colours are literal in `londonMap.css`, per the variant contract — a background *is* colour, so variant
stylesheets are a literal-colour site like `deepSlate.css` and `TERM_THEME`.

## 5. Architecture

### 5.1 Bake pipeline — build-time, run once, output committed

`scripts/bake-london-map.mjs`, run manually. Not a build step and not a runtime fetch: the app ships the
finished geometry, so it needs no network, no API key, and no Rust.

1. **Fetch** — TfL `Line/{id}/Route/Sequence/{direction}` per line; Overpass for roads and the Thames.
2. **Merge** contiguous same-class ways into long polylines.
3. **Simplify** (Douglas–Peucker) at render-pixel tolerance.
4. **Project** into a fixed pixel space (§5.3).
5. **Emit** `src/background/londonMap.data.ts` — one `d` string per class, plus tube station sequences.

Four gotchas learned the hard way, recorded so the script doesn't have to relearn them:

- **Overpass: use exact tag matches, never a regex.** `way["highway"~"^(a|b)$"]` bypasses the tag index
  and forces a full scan over the bbox — it 504s repeatedly on both the public endpoint and the kumi
  mirror. A union of `way["highway"="a"];way["highway"="b"];` uses the index. Query in strips regardless,
  and expect throttling after a few large calls.
- **OSM fragments roads at every junction, and merging before simplifying is worth 5×.** Measured:
  13,667 ways carrying 54,892 coordinates for the primary tier — about 4 points per way, i.e. most
  "roads" are 2-point stubs with nothing to simplify. Simplifying them as-is only halves the data.
  Merging first collapses 13,667 ways into 1,084 chains, and Douglas–Peucker over those long polylines
  then gets to 5,269 points — a 10× reduction overall. Order matters more than tolerance here.
- **OSM's riverbank polygons are UNNAMED — the name is on the centreline.** Searching
  `natural=water` + `name="River Thames"` inside the bbox returns **nothing**; searching any feature
  named "River Thames" returns thirty streets and railways and not one piece of river. The banks are
  `natural=water` + `water=river` multipolygons carrying no name at all (relation 28934 is the main
  one, 31 outer and 58 inner rings). So the water query filters on `water=river`, which is also why
  the layer is `water` rather than `thames` — it takes every river and dock in the box.
- **TfL `lineStrings` are station-to-station chords, not track geometry.** The Victoria line returns 16
  coordinates for 16 stations. So the tube layer is polygonal straight from the API — invisible in
  central London (station spacing is ~10–20px at this scale) but visible on long outer segments. Spline
  the station points (Catmull–Rom) for organic curves.

### 5.2 Runtime — the variant

- `src/background/londonMap.tsx` — component with a static import of the baked data. One `<svg>`
  containing **9 `<path>` elements**: one per road class, one for tube, one for the Thames, plus a
  blurred duplicate of each of the three glowing classes (§4).
- `src/background/londonMap.css` — the strokes.
- One entry in `registry.tsx`. No consumer changes anywhere — that's the seam's promise.

**One path per class is the load-bearing decision.** SVG allows a single `<path>` to hold many
*disconnected* subpaths (`M…L…M…L…`), so an entire road class collapses into one element. Without this
the layer would be ~13,600 nodes for the primary tier alone. With it, node count stops being a concern
*and* "one stroke setting per class" — exactly the requested weight hierarchy — falls out of the
encoding for free.

### 5.3 Projection and framing

Equirectangular with a `cos(latitude)` correction. Baked into a fixed pixel space of 2000 × 1246 px,
which at 21 km is ~10 m/px — also the simplification tolerance, since sub-pixel precision is dead weight.

**The correction divides, it does not multiply.** Pixels-per-degree of *latitude* is the larger of the
two, because a degree of longitude covers less ground the further from the equator:
`scaleY = scaleX / cos(lat₀)`, ≈ scaleX / 0.622 at 51.5°N. Getting this backwards squashes London
vertically, and it is easy to get backwards — a unit test pins the resulting aspect ratio.

Framing is `viewBox` + `preserveAspectRatio="xMidYMid slice"`, which is `cover` with no CSS involved.

**No projection ships at runtime.** An earlier draft of this spec promised an exported `project()` so
train positions would use the same transform as the map. Planning found that unnecessary: if the bake
emits tube station coordinates already *in pixel space*, then step 2 interpolates a train between two
station pixel positions and never converts a lat/lon at all. The projection parameters are still
recorded in the data file as provenance — and so a future lat/lon consumer has them — but there is no
runtime transform to keep in agreement, which is a stronger guarantee than the original one.

### 5.4 Testable surface

The repo's suite is pure-logic only, so: `project`, the framing maths, and the composition that drives
them (`bakeLayer` — merge → project → simplify → emit) get unit tests. Merge and simplification
*tolerances* are still judged by eye.

**Honest limit on "verified by eye".** The output is committed, so it is *revertable* and its size is
checkable — but it is not meaningfully diffable: it emits as a single ~97 KB line, and because OSM
changes upstream, a re-bake's diff can't be compared against the previous one anyway. The real check on
the geometry is therefore the tests over the pure functions plus a human looking at the rendered map, not
review of the artefact. That is why `bakeLayer` belongs on the tested side: it carries the
`[lon, lat]` → `(lat, lon)` swap, whose failure mode is a plausible-looking road network somewhere other
than London — exactly the error an unreviewable artefact hides.

## 6. Failure modes

There are none at runtime, by construction. The data is a static import: no network, no key, nothing to
time out. This matters because **a background has nowhere to show an error** — so the design removes the
possibility rather than handling it.

Reduced motion: drift removed, map static. Nothing else changes, since the map is static anyway.

Attribution: both licences require it — "Powered by TfL Open Data" and "© OpenStreetMap contributors" —
and a background can't display it. Both go in Settings beside the background picker, and in the bake
script's output header.

## 7. What this guarantees the vehicles step

Decisions made now, purely so step 2 needs no rework:

- **Bake the full tube network; clip at render time.** Trains bound for Heathrow or Cockfosters sail
  off-frame naturally, and widening the box later is a CSS change rather than a re-bake and re-tune.
  **Caveat: the viewport clip constrains what is *painted*, not what is *processed*.** A filter's region
  derives from the unclipped object bounding box, and clipping happens *after* filtering, so `clip-path`
  cannot shrink it either — the tube layer alone spans ~5700 × 3200 user units against a 2000 × 1246
  frame. Any filter applied to a group containing tube geometry must pin its own region (§4), or WebKit
  may clamp it or drop it. The same applies to anything the vehicles step filters.
- **Station sequences stay ordered and keyed by NaptanId** (`940GZZLUWWL`-style, confirmed present in the
  API response), **with their pixel coordinates baked alongside**. Arrival predictions reference exactly
  that id, so step 2 needs neither name matching nor a coordinate transform (§5.3).
- **The tube layer gets its own `<g>`**, so trains become siblings above it with no restructuring.
- **Station-to-station segments are the data's native fidelity** (§5.1), so interpolating a train along a
  straight chord between two stations isn't an approximation — it's exactly as precise as the geometry.

**One debt the vehicles step inherits, and it bites exactly here.** The bake dedupes whole station
*sequences*, not shared track, so a line's branches each redraw the trunk they share: 452 station
placements over 272 distinct stations, about 10 deep on the Northern line's core. This is invisible today
for one reason only — the whole network is a single `<path>`, so its opacity composites once. **Splitting
the tube layer per line — which is the obvious first move for line colours, per-line hover, or per-line
train layers — makes every trunk section jump to roughly 10× brightness.** Dedupe overlapping segments in
the bake before splitting, not after noticing the glare.

## 8. Sizes — measured

All figures below are measured against the §3 bbox at a 2000px render target and 1px tolerance, after
merge + simplify + pixel rounding, as emitted into an SVG `d` string:

| Layer | Fetched | Path data |
|-------|---------|-----------|
| Motorway | 0 ways | **empty** (§2) |
| Trunk / primary | 15,685 ways | **47.6 KB** |
| Secondary | 2,624 ways | **10.6 KB** |
| Tertiary | 4,843 ways | **21.8 KB** |
| Water | 37 elements → 34 rings | **11.2 KB** |
| Tube | 11 lines → 50 sequences | **14.8 KB** |
| **Total** | | **106 KB across 6 layers** |

Merging is what makes those numbers small, and the effect is worth restating: the trunk/primary tier's
15,685 ways carry ~55,000 coordinates, which merge into ~1,100 chains and simplify to ~5,300 points — a
10× reduction, where simplifying the unmerged fragments alone manages 2×. Order matters more than
tolerance (§5.1). The same stitching turns the water layer's 135 member ways into 43 closed rings.

Two layers grew after the first cut, both deliberately: tertiary (§2) because the map read as a
skeleton without it, and water because bank polygons buy the river's actual shape where a centreline
cannot. 106 KB is still small for a locally-bundled desktop app — the remaining levers, in order, are
raising the simplification tolerance and then dropping a tier, both one constant in the bake script.

**Water is baked to different settings from everything else**, and both differences fix visible
raggedness on a filled edge that a stroke would have hidden. It simplifies at `WATER_TOLERANCE_PX = 2`
rather than 1, because the Thames carries enough piers and dock inlets to fringe the bank with teeth;
and `toAreaD` emits tenths of a pixel where `toPathD` emits whole ones, because the viewBox is
routinely displayed larger than 2000 units and each rounding step then shows as a notch. Together they
made the layer *smaller* as well as smoother — 914 points against 1,539.

## 9. Deferred

Live trains (step 2). Station markers. Labels. DLR / Overground / Elizabeth line. Parks and other water.
A schematic mode. Aurora drift — parked as a separate variant, agreed earlier and still wanted.

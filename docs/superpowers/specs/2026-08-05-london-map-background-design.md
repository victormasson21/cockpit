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
| Motorway / trunk / primary roads | OSM (Overpass) | includes `*_link` slip roads |
| Secondary roads | OSM (Overpass) | the agreed floor — nothing smaller |
| Tube lines | TfL Unified API | all lines, geographic; the bright layer |
| The Thames | OSM | one shape, essential for legibility |

**Not** drawn: trains, station markers, labels, parks, other water, buildings, tertiary/residential
roads, DLR / Overground / Elizabeth line. Station *coordinates* are baked regardless (§7) but nothing
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

The variant paints **strokes only** — no ground of its own. `.app__bg` already sits above body's
`--bg-0`, so the existing dark blue shows through untouched.

**Glow is a two-layer stroke, never `box-shadow`.** The Night Sky iteration established why: a shadow's
blur leaves the shape's own area fully opaque and only softens outwards, which reads as a hard core with
a soft rim. For strokes the correct idiom is a duplicated wide stroke group under a static
`filter: blur()`, with the crisp stroke painted on top. "Slight" then becomes one tunable.

The glow layer covers **major classes only** — tube, motorway, trunk/primary. Glowing every secondary
road is both mush to look at and the expensive half of rasterisation.

Starting values, to tune by eye on first render:

| Class | Width | Opacity | Glow |
|-------|-------|---------|------|
| Secondary | 0.6px | 0.10 | no |
| Primary / trunk | 1.0px | 0.18 | faint |
| Motorway | 1.4px | 0.26 | yes |
| Tube | 1.2px | 0.45 | yes |
| Thames | 3.0px | 0.14 | no |

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

Three gotchas learned while scoping, recorded so the script isn't rediscovered the hard way:

- **Overpass: use exact tag matches, never a regex.** `way["highway"~"^(a|b)$"]` bypasses the tag index
  and forces a full scan over the bbox — it 504s repeatedly on both the public endpoint and the kumi
  mirror. A union of `way["highway"="a"];way["highway"="b"];` uses the index. Query in strips regardless,
  and expect throttling after a few large calls.
- **OSM fragments roads at every junction, and merging before simplifying is worth 5×.** Measured:
  13,667 ways carrying 54,892 coordinates for the primary tier — about 4 points per way, i.e. most
  "roads" are 2-point stubs with nothing to simplify. Simplifying them as-is only halves the data.
  Merging first collapses 13,667 ways into 1,084 chains, and Douglas–Peucker over those long polylines
  then gets to 5,269 points — a 10× reduction overall. Order matters more than tolerance here.
- **TfL `lineStrings` are station-to-station chords, not track geometry.** The Victoria line returns 16
  coordinates for 16 stations. So the tube layer is polygonal straight from the API — invisible in
  central London (station spacing is ~10–20px at this scale) but visible on long outer segments. Spline
  the station points (Catmull–Rom) for organic curves.

### 5.2 Runtime — the variant

- `src/background/londonMap.tsx` — component with a static import of the baked data. One `<svg>`
  containing **~6–8 `<path>` elements**: one per road class, one for tube, one for the Thames, one
  blurred duplicate for the glow.
- `src/background/londonMap.css` — the strokes.
- One entry in `registry.tsx`. No consumer changes anywhere — that's the seam's promise.

**One path per class is the load-bearing decision.** SVG allows a single `<path>` to hold many
*disconnected* subpaths (`M…L…M…L…`), so an entire road class collapses into one element. Without this
the layer would be ~13,600 nodes for the primary tier alone. With it, node count stops being a concern
*and* "one stroke setting per class" — exactly the requested weight hierarchy — falls out of the
encoding for free.

### 5.3 Projection and framing

Equirectangular with a `cos(latitude)` correction on x (≈0.62 at 51.5°N; without it London looks
horizontally stretched). Baked into a fixed pixel space of ~2000px width, which at 21 km is ~10 m/px —
also the simplification tolerance, since sub-pixel precision is dead weight.

Framing is `viewBox` + `preserveAspectRatio="xMidYMid slice"`, which is `cover` with no CSS involved.

`project(lat, lon) → {x, y}` is exported and pure. That matters for §7: a train's runtime position must
go through the *identical* transform as the baked map, or the two layers disagree.

### 5.4 Testable surface

The repo's suite is pure-logic only, so: `project` and the framing maths get unit tests. Merge and
simplification live in the one-off script and are verified by eye — their output is committed, diffable
and reviewable, which is the appropriate check for a build artefact.

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
- **Station sequences stay ordered and keyed by NaptanId** (`940GZZLUWWL`-style, confirmed present in the
  API response). Arrival predictions reference exactly that id, so step 2 needs no name matching.
- **The tube layer gets its own `<g>`**, so trains become siblings above it with no restructuring.
- **`project` is exported and pure** (§5.3).
- **Station-to-station segments are the data's native fidelity** (§5.1), so interpolating a train along a
  straight chord between two stations isn't an approximation — it's exactly as precise as the geometry.

## 8. Sizes — measured

All figures below are measured against the §3 bbox at a 2000px render target and 1px tolerance, after
merge + simplify + pixel rounding, as emitted into an SVG `d` string:

| Tier | Ways | Coords | Merged chains | Simplified | Subpaths | Path data |
|------|------|--------|---------------|------------|----------|-----------|
| Motorway / trunk / primary | 13,667 | 54,892 | 1,084 | 5,269 | 1,050 | **42 KB** |
| Secondary | 2,350 | 12,058 | 269 | 1,205 | 263 | **9 KB** |
| **Roads total** | | | | | | **51 KB in 2 `<path>` elements** |

The tube network adds tens of KB at most (one line's inbound sequence is 51 KB of raw JSON but extracts
to 16 coordinates), and the Thames is a single shape. **The whole map lands comfortably under 100 KB.**

This is roughly 4× smaller than first estimated, because that estimate simplified unmerged fragments.
There is therefore headroom: tertiary roads are affordable if the map wants more texture, and the
simplification tolerance could be tightened rather than loosened. Neither is planned — noted so the
choice is known to be cheap rather than rediscovered.

## 9. Deferred

Live trains (step 2). Station markers. Labels. DLR / Overground / Elizabeth line. Parks and other water.
A schematic mode. Aurora drift — parked as a separate variant, agreed earlier and still wanted.

# London map — live trains (design)

Date: 2026-08-17
Status: design agreed, not yet implemented
Follows: `2026-08-05-london-map-background-design.md` (§9 deferred: "Live trains (step 2)")

## 1. What this is

The London map background currently draws a still network. This adds the thing it was built for:
Underground trains, as small line-coloured dots gliding between stations, positioned from TfL's live
arrival predictions.

The map's step-2 guarantees are already in place and this design consumes them unchanged — the full
network is baked (not clipped to the frame), station coordinates are pre-projected into pixel space and
keyed by NaptanId, and the tube layer has its own `<g>` for trains to sit above.

## 2. Scope

**In:** the 11 Underground lines; dots only; the existing frame; opt-in via its own background variant.

**Out:** DLR, Overground, Elizabeth line, trams (no baked geometry). Station markers. Labels. Train
direction indicators, occupancy, delays or status text. Any UI chrome — this is a background.

## 3. The feed (measured 2026-08-17, not assumed)

`GET https://api.tfl.gov.uk/Line/{ids}/Arrivals`, all 11 line ids comma-separated in one request:

| | |
|---|---|
| response | 3.9 MB, 4,236 predictions, 0.4s |
| trains in service | 436 distinct `vehicleId`s, **zero blank** |
| predictions per vehicle | ~15 — the vehicle's entire onward journey, not just its next stop |
| in frame | 280 (64%) · outside 156 (36%) |
| auth | **none** — no key, no account, no cost |
| CORS | `access-control-allow-origin: *` |
| cache | `max-age=30` — TfL's own refresh cadence |

Each prediction carries `vehicleId`, `lineId`, `naptanId`, `timeToStation` (seconds), `direction`,
`towards`, `currentLocation`. The `naptanId`s match the baked map's station keys directly, so no name
matching is needed anywhere.

**Consequence that shapes the whole design:** because a vehicle arrives with its full forward schedule,
one fetch is enough to animate that train for several minutes. Polling can therefore be slow and cheap.

## 4. Polling

TfL is free and rate limits are generous, so **cost is not the constraint — payload is**. 3.9 MB every
30s is ~470 MB/hour and a large main-thread JSON parse, which this app has a history of suffering from.

**Round-robin, one line per tick.** A tick every ~11s fetches a single line (~350 KB, ~5ms parse); all
11 refresh every ~2 minutes. This keeps bandwidth at roughly a third of a naive 30s full poll, keeps
every parse small enough that no Web Worker is needed, and spreads load evenly rather than spiking.

Polling runs only when **the variant is selected AND `document.visibilityState === "visible"`**. A
hidden window freezes CSS animations but not timers — the Night Sky iteration was bitten by exactly
this — so ticks stop when hidden and resume on return.

## 5. Deriving a position

For each `vehicleId`, take its two soonest predictions:

- **next station** = soonest prediction's `naptanId`, arriving in `timeToStation` seconds.
- **the station after that** = second-soonest prediction's `naptanId`.

**The API gives the line, but not the branch.** Every prediction carries `lineId`, so use it — it
narrows the baked data's **50 branch sequences** (`central-1`, `northern-2`, …) down to that line's
handful. What it does not give you is which branch of that line the train is physically on, and
`destinationNaptanId` (present on 100% of predictions) does not close the gap: on the Northern line
*Edgware via Bank* and *Edgware via CX* share a destination while running on different tracks through
central London, as do the Morden, High Barnet and Mill Hill East pairs. The `towards` string does
encode the routing, but it is free text and already inconsistent in the live data ("via CX", not "via
Charing Cross"), alongside values like "Check Front of Train" and "Special" — too brittle to parse.

So disambiguate **structurally**, using the station-after-next: within the sequences for that `lineId`,
find the one where *next* and *station-after-next* are adjacent — that pair distinguishes via-Bank from
via-CX with no string matching. The **previous station** is then the neighbour of *next* on the
opposite side from *station-after-next*. Stateless; no cross-poll tracking.

That yields the train's **segment** (previous → next) and its **progress** along it, from
`timeToStation` counting down against the segment duration — taken as the gap between the two soonest
predictions where available, else a default. Progress is not turned into a coordinate here: §6.1 hands
segment + progress to a pre-baked animation, which is what actually places the train on the curve.

**Fallbacks, in order:** ambiguous branch → animate from the train's last rendered position toward
*next*; no last position (first sighting) → place it at *next* offset back along the segment by the
elapsed fraction; unknown NaptanId (a station outside the baked set) → drop the train.

## 6. Look and motion

- **A dot per train, in its line's colour, with a slight glow** — the same two-layer idiom the map's
  strokes use (a wider blurred copy beneath a crisp core), not `box-shadow`, which leaves an opaque
  centre and a hard rim.
- **Map lines stay white.** The trains then carry the only colour on screen, which makes them the focus
  and preserves the "white lines-only overlay" the map was designed around.
- The 11 official line hexes are literals in the variant's stylesheet — background variants are an
  allowed literal-colour site, like `deepSlate.css` and `TERM_THEME`.
- **Only in-frame trains get elements** (plus a small margin so they enter smoothly) — ~280 rather than
  436. Off-frame trains are still tracked, just not rendered.
- Elements are keyed by `vehicleId` so React reuses them across refreshes.

### 6.1 Trains must follow the splined line, not the chord

The map splines its tube geometry (uniform Catmull-Rom, tension 1/6, `splineD` in `mapGeometry.mjs`),
so a train interpolating linearly between two stations flies along the chord while the drawn line bows
away from it. **Measured** against the baked coordinates, over the 237 in-frame segments:

| | |
|---|---|
| median deviation | 2.7px |
| p90 | 7.4px |
| max | 32.4px (Metropolitan, over a 293px segment) |
| segments over 2px / 4px / 8px | 63% / 32% / 7% |
| median in-frame segment length | 74px |

A train dot with its glow is ~4–6px across, so at p90 it sits more than its own width off the line and
at worst is 30px adrift in blank space. Linear interpolation is therefore **not viable** — this was
measured, not assumed, and an earlier draft of this spec guessed otherwise.

**Decision: pre-baked per-segment `@keyframes`.** For every station-to-station segment, emit one
`@keyframes` rule describing the curve as a series of `translate()` stops sampled along the spline. A
train is placed on a segment with `animation-name: seg-<id>`, a duration derived from `timeToStation`,
and a **negative `animation-delay`** to start part-way through — the same trick Night Sky uses to age
its stars, so the idiom already exists in this codebase. Reverse traversal uses
`animation-direction: reverse` rather than a mirrored rule set.

This gives exact curve-following with **zero per-frame main-thread work**, which is the whole point:
`offset-path` + `offset-distance` would also follow the curve exactly but is not compositor-accelerated
in WebKit, putting ~280 elements onto the main thread behind live terminals.

Sampling is **adaptive** — stop count driven by each segment's deviation, so the 22% of segments that
bow under 1px emit two stops and only genuinely curved ones cost anything.

**Escape hatch.** If this proves fiddly, un-splining the tube layer is a one-line change to the map
bake that makes alignment perfect for free. The real cost of that is smaller than it sounds: in-frame
the median bow is 2.7px over a 74px segment at a 1–2px dim stroke, which is roughly what `splineD`'s
own comment predicts ("invisible in central London"). Splining was added for long outer segments, most
of which this frame crops. The visible exception is that one Metropolitan segment, which would
straighten noticeably.

## 7. Failure and degradation

A background has nowhere to display an error, so there is no error state by construction:

- **Fetch fails** → keep the last known positions, retry on the next tick.
- **Never succeeded** (offline, API down) → the static map, exactly as it renders today.
- **Night** → the tube closes, so the correct render is zero trains. Must look deliberate, and does:
  it degrades to the still map.
- **Reduced motion** → trains render at their current positions and hold still; no ticks, no animation.

## 8. Where it lives — and how to delete it

**Hard requirement: the static map and the live-trains variant are separate units.** The user picks
between them, and the trains must be removable wholesale if they turn out to be too heavy or too
complex — without re-baking the map, without touching its data file, and without regressing the
variant that already ships.

New files, all additive:

- `src/background/londonTrains.ts` — pure: predictions → `{ segment, progress }`. Unit-tested, matching
  the map's `mapGeometry.test.mjs` convention. No DOM, no fetch.
- `src/background/londonTrains.tsx` — the layer: polling, visibility gating, element keying.
- `src/background/londonTrains.css` — dot, glow, and the line-colour literals.
- `src/background/londonTrainSegments.data.css` — GENERATED: the per-segment `@keyframes` from §6.1.
- `scripts/bake-train-segments.mjs` — generates the above.

Existing files, touched minimally:

- `registry.tsx` — **one added entry**, "London map · live".
- `londonMap.tsx` — accepts an optional child layer rendered inside the tube `<g>`. This is the only
  change to shipped map code, and with no child it renders exactly as it does today.

**`londonMap.data.ts` is not modified, and the map's bake is not re-run.** The segment keyframes are
derived *downstream* from the station coordinates already baked into it, applying the same Catmull-Rom
maths `splineD` uses. So `bake-train-segments.mjs` reads the committed map data and needs neither
Overpass nor TfL — which is what keeps the two units independent.

**Removal path:** delete the five new files, delete the one registry entry, revert the optional-child
parameter. The static map is untouched throughout.

A separate registry entry rather than a setting on the existing one also means picking a background
never silently starts network activity you did not ask for; and offline the live variant degrades to
precisely the static one, so the pair stays coherent.

## 9. Testable surface

Pure and unit-testable: branch disambiguation (including the ambiguous case), previous-station
resolution, segment + progress at t=0/0.5/1, the in-frame filter including the margin, round-robin tick
sequencing, and the fallback ladder in §5. In the bake script: Catmull-Rom sampling matching `splineD`,
adaptive stop-count selection, and the guarantee that every emitted segment id is referenced by exactly
one keyframes rule. Polling, visibility and rendering are integration concerns verified by GUI smoke,
as with every other background work in this repo.

## 10. Open risks

1. **~280 animated elements over the map's ~8 static paths** is the main unknown. Mitigation if it
   bites: thin to fewer lines, or larger dots at lower count. Measure during tuning.
2. **Keyframes bundle size.** Adaptive sampling should keep it to tens of KB, but it is generated
   output — check it before committing, as with `londonMap.data.ts`.
3. **Prediction quality at the tails** — a train sitting at a terminus can report odd `timeToStation`
   values. Clamp to the segment.

## 11. Deferred

Station markers. Labels. DLR / Overground / Elizabeth line. Direction or delay encoding. Aurora drift
remains parked as a separate variant, still wanted.

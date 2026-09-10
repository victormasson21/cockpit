# Replacing the logo

The logo (since 2026-07-07: the persimmon-tree drawing, dark ink + orange fruit) is displayed in
exactly **two** places. The header shows a logo again since 2026-07-08, but NOT this artwork: it's
the separate monochrome **tree glyph** (`src/assets/icons/tree.svg`, masked `.app__logo` span in
`.app__brand`, tinted `--tx-hi`) — the detailed persimmon drawing stays out of the header (at 20px
it was too tight/muddy next to the brand text; don't re-add an `<img>` of it there). The same tree
glyph is the slot-column identity icon (`.wt-col__icon--tree`, attention-tinted via the shared
background swap); the git pane + Checkout heading keep `branch.png`.

1. **Favicon** — `public/cockpit-tree.png` (256×256, transparent), referenced from `index.html` as
   `<link rel="icon" type="image/png" href="/cockpit-tree.png" />`.
2. **App/dock icons** — `src-tauri/icons/*`. `tauri.conf.json` `bundle.icon` lists `32x32.png`,
   `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`; the generator also rewrites the
   Windows `Square*`/`StoreLogo` files and the 1024×1024 `icon.png` (keep that one — it doubles as
   the master source for future regenerations). The app icon is NOT the bare artwork: it sits on a
   **macOS-style rounded-rect plate** (a bare transparent PNG looked wrong next to real Dock icons).

Procedure to swap in a new logo image:

1. **Make the source a square 1024×1024 PNG with a transparent background.** `tauri icon` needs
   alpha, and an opaque background becomes a literal white square on the dock. If the artwork sits
   on white, derive per-pixel alpha from whiteness using **`min(r, g, b)`** — NOT `max()`: saturated
   colours (e.g. the orange fruit) have one high channel, so `max()` wrongly erases them. Thresholds
   that worked: whiteness > 250 → alpha 0; whiteness > 230 → alpha `255 - whiteness` (softens
   anti-aliased edges); else fully opaque. No ImageMagick on this machine — use Pillow in a
   throwaway venv (`python3 -m venv venv && pip install pillow`).
2. **Compose the app-icon variant on a plate** (Pillow again): 1024×1024 transparent canvas,
   `rounded_rectangle([100, 100, 924, 924], radius=185)` filled **`#F4F0E6`** (warm off-white,
   user-picked), artwork resized to ~660px and centered. This mimics the Big Sur icon shape.
3. Run `npm run tauri icon -- /abs/path/to/plated-icon-1024.png` — regenerates all of
   `src-tauri/icons/`. It **also emits `icons/ios/` and `icons/android/`** — delete both
   (desktop-only app, nothing references them).
4. Replace `public/cockpit-tree.png` with a 256×256 resize of the bare transparent artwork — the
   favicon deliberately has **no plate** (reads better at tab size); update `index.html` if the
   filename changes.
5. Verify: `npm run build` + `npx vitest run` green; eyeball `src-tauri/icons/128x128.png` (Read it
   as an image) to confirm nothing got alpha-mangled.
6. **Dock-icon gotcha (verified 2026-07-07):** in dev the Dock icon is embedded into the binary at
   compile time, and **cargo does not track the icon files** — after regenerating icons,
   `cargo build` reports "Finished" in ~0.1s without recompiling, so restarting `tauri dev` alone
   still shows the OLD icon. Force it: `touch src-tauri/build.rs && cargo build` (recompiles the
   cockpit crate, re-embedding the icons), then restart `tauri dev`. A bundled `.app` from
   `tauri build` needs the same touch first for the same reason.
7. Keep the entire swap (icons + favicon + any code) in **one commit** so it rolls back with a
   single `git revert`.

History: the original logo was `cockpit-radar.svg` (in `src/assets/` for the header import and in
`public/` for the favicon) — both deleted in the 2026-07-07 swap.

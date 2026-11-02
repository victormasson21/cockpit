# Replacing the logo

The logo (since 2026-11-02: the tree mark, green `#5AC488` crown with one coral `#D9836F` circle, on a
dark-blue plate for the app icon) is displayed in **three** places:

1. **In-app** — `src/views/Logo.tsx`, an inline SVG with fixed brand colours and a `size` prop
   (default 24). At 20px and below it draws the simplified mark (plain trunk, no sprouts or root
   flare). It is every tree icon in the UI: header (18px), worktree slot (17px), the "Add" worktree
   button (14px) and the ⓘ popup's directory row (12px). CSS repaints every fill to one colour where
   needed: `--bad` for the slot's attention state (`.wt-col__logo--attention`), `--tx-3` grey in the
   ⓘ popup to match its sibling icons (`.wt-info__logo`).
2. **Favicon** — `public/cockpit-mark.svg`, referenced from `index.html`.
3. **App/dock icons** — `src-tauri/icons/*`. `tauri.conf.json` `bundle.icon` lists `32x32.png`,
   `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`. `icon.png` (1024×1024, plate included)
   is the master source for future regenerations.

Procedure to swap in a new logo:

1. Get a 1024×1024 PNG app icon with a transparent background, plate and shadow already drawn.
2. Run `npm run tauri icon -- /abs/path/to/icon-1024.png` — regenerates all of `src-tauri/icons/`.
   It **also emits `icons/ios/` and `icons/android/`** — delete both (desktop-only app).
3. If a finished `.icns` exists, copy it over `src-tauri/icons/icon.icns`: it carries hand-tuned
   small sizes that the generator cannot match.
4. Update the paths in `Logo.tsx` and replace `public/cockpit-mark.svg`.
5. Verify: `npm run build` + `npm test` green; Read `src-tauri/icons/128x128.png` as an image.
6. **Dock-icon gotcha (verified 2026-07-07):** the icon is embedded into the binary at compile time,
   and **cargo does not track the icon files** — `cargo build` reports "Finished" without
   recompiling, so the OLD icon still shows. Force it: `touch src-tauri/build.rs`, then build. A
   bundled `.app` from `tauri build` needs the same touch first. Finder caches icons too:
   `touch` the `.app` bundle, then `killall Dock`.
7. Keep the entire swap in **one commit** so it rolls back with a single `git revert`.

History: `cockpit-radar.svg` (until 2026-07-07), then the persimmon-tree drawing on a `#F4F0E6`
plate with the tree glyph in the header (until 2026-11-02).

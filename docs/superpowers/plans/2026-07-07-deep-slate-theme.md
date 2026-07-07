# Deep Slate (2b) Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current ad-hoc dark theme with the spec'd **Deep Slate** theme: a canonical token file, a ThemeProvider seam for future themes, all components on the new token vocabulary, fixed always-dark terminal/diff palettes, locally-bundled Inter + JetBrains Mono, and a macOS overlay titlebar.

**Architecture:** `src/theme/deepSlate.css` holds the canonical colour/type/shape tokens under `[data-theme="deep-slate"]`; `src/theme/tokens.css` becomes the theme-*agnostic* baseline (spacing, type scale, element baselines) written against the new token names; a tiny `ThemeProvider` sets `data-theme` on `<html>` and imports the theme CSS + fonts. Component CSS is renamed onto the new vocabulary with per-role exceptions (red nav, green New button, info chips, status trios). Terminal bodies and the diff code area keep FIXED literals per spec §3.

**Tech Stack:** React 19 + TS, Vite, CSS custom properties, `@fontsource/inter` + `@fontsource/jetbrains-mono`, xterm.js `theme` option, Tauri v2 window config.

## Global Constraints

- Token values from the spec are used **verbatim** (e.g. `--bg-0:#122A3E`, `--accent:#7CACE0`, `--nav-active:#C15E4C`, `--btn-new:#5AC488`, `--term:#0E1F2D`).
- **No literal hex/rgba in component files** except the spec §3 fixed terminal/syntax/diff set (xterm theme in `useTerminal.ts`, diff code area in `CockpitView.css`) and Claude brand orange `#D97757`.
- Single action colour = `--accent` (steel blue); green is ONLY the `+ New` button; red fill is ONLY the active view tab.
- Chips (channels, repo, branch, ticket ids, workspace/pane numbers) use the `--info-*` trio.
- Hover = `--hover` state layer over the resting fill, 200ms ease-out.
- Fonts bundled locally (fontsource) — no CDN.
- Dark chrome regardless of system appearance; opaque surfaces (no vibrancy).
- Old token names (`--bg`, `--surface-raised`, `--text-secondary`, `--attention-warm`, …) are **deleted** — a leftover reference must fail the Task 7 grep sweep.
- Keep all 113 JS tests green; `npm run build` (tsc + vite) clean.
- Every file keeps/gets its one-line role comment (CLAUDE.md convention).

## Token migration table (old → new)

Mechanical unless a per-file exception in a task says otherwise:

| Old | New |
|---|---|
| `--bg` | `--bg-0` |
| `--surface` | `--surface` (tiles/cards) — but top bar/column headers → `--bg-2` (exceptions listed per task) |
| `--surface-raised` | `--bg-3` |
| `--overlay` | `--overlay` (kept, defined in deepSlate.css as an addition) |
| `--border` | `--bdr` |
| `--border-subtle` | `--divider` |
| `--text` | `--tx` |
| `--text-secondary` | `--tx-2` |
| `--text-muted` | `--tx-3` |
| `--accent` | `--accent` (new steel-blue value) |
| `--accent-fg` | `--on-accent` |
| `--attention` | `--warn-tx` |
| `--attention-warm` | `--bad` |
| `--attention-warm-rgb` | `--bad-rgb` (addition, rgb channels of `--bad`) |
| `--danger` | `--bad-tx` (text) / `--bad` (fills) |
| `--ok` | `--ok` |
| `--info` | `--info-tx` (chip markers) / fixed `#8fb6e0` (diff hunk, always-dark area) |
| `--pr` | `--info-tx` (chip markers unified onto the info trio) |
| `--git` | (unused — delete) |
| `--diff-add` | `--add-mark` (+N stats) / `--add-tx` (added line text) |
| `--diff-del` | `--del-mark` / `--del-tx` |
| `--radius` | `--r` (13px) |
| `--radius-sm` | `--r-sm` (9px) |
| `--font-ui` | `--ui` |
| `--font-mono` | `--mono` |
| `--fs-*`, `--space-*`, `--font-scale` | unchanged (theme-agnostic, stay in tokens.css) |

---

### Task 1: Fonts + Deep Slate token file + ThemeProvider

**Files:**
- Create: `src/theme/deepSlate.css`
- Create: `src/theme/ThemeProvider.tsx`
- Test: `src/theme/ThemeProvider.test.tsx`
- Modify: `src/main.tsx`
- Modify: `package.json` (via npm install)

**Interfaces:**
- Produces: `<ThemeProvider>` React component (children pass-through; sets `data-theme="deep-slate"` on `document.documentElement`); the full Deep Slate token set under `[data-theme="deep-slate"]`.

- [ ] **Step 1: Install fonts**

```bash
npm install @fontsource/inter @fontsource/jetbrains-mono
```

(Static fontsource packages register family names `'Inter'` / `'JetBrains Mono'`, matching the spec token strings verbatim; Vite bundles the woff2 files so the packaged app needs no network.)

- [ ] **Step 2: Write the failing ThemeProvider test**

`src/theme/ThemeProvider.test.tsx`:
```tsx
// ThemeProvider.test.tsx — the provider must brand the root element and render its children.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "./ThemeProvider";

describe("ThemeProvider", () => {
  it("sets data-theme on <html> and renders children", () => {
    render(<ThemeProvider><span>inside</span></ThemeProvider>);
    expect(document.documentElement.getAttribute("data-theme")).toBe("deep-slate");
    expect(screen.getByText("inside")).toBeTruthy();
  });
});
```

If `@testing-library/react` is not installed (check existing tests first — other component tests may already use it), install it: `npm install -D @testing-library/react`. If the project's vitest has no jsdom environment configured, add `// @vitest-environment jsdom` at the top of the test file and `npm install -D jsdom` if missing.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/theme/ThemeProvider.test.tsx`
Expected: FAIL — cannot resolve `./ThemeProvider`.

- [ ] **Step 4: Create `src/theme/deepSlate.css`**

Spec tokens verbatim, on the `data-theme` selector, plus two flagged additions (`--overlay`, `--bad-rgb`):

```css
/* deepSlate.css — the "Deep Slate" (2b) theme: canonical colour/type/shape tokens.
   Future themes redefine this same token contract under their own [data-theme]. */
:root[data-theme="deep-slate"] {
  /* type + shape */
  --ui: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
  --r: 13px;  --r-sm: 9px;

  /* surfaces (bg-0 darkest ground → surface = cards) */
  --bg-0:#122A3E; --bg-1:#173245; --bg-2:#1C3B57; --bg-3:#123453;
  --surface:#234A66; --term:#0E1F2D;

  /* borders */
  --bdr:#345B7E; --bdr-2:#43719B; --divider:#294E6C; --bdr-soft:#3B6791;

  /* text (hi = headings → tx-4 = faintest) */
  --tx-hi:#EAF1F7; --tx:#C4D2DE; --tx-2:#93A8BA; --tx-3:#6B8397; --tx-4:#43596C;

  /* action / accent (steel blue) */
  --accent:#7CACE0; --accent-strong:#97C1EC; --on-accent:#0E2135;

  /* --- the two intentional 2b accents --- */
  --nav-active:#C15E4C;        /* active segmented-control tab fill (red) */
  --btn-new:#5AC488;           /* primary "New" button (bright green)     */
  --on-btn-new:#0E2135;        /* text/icon on the green button           */

  /* info / secondary (channel names, PR repo, branch, workspace chips) */
  --info-tx:#A3C8EE; --info-bg:#234A6E; --info-bdr:#3E70A2;

  /* status */
  --ok:#6CC593;   --ok-bg:#154637;   --ok-tx:#84D3A7;   /* success / running / passed */
  --warn:#D5B87F; --warn-bg:#443A1B; --warn-tx:#E2C591; /* in-progress / warm */
  --bad:#D9836F;  --bad-bg:#4A251E;  --bad-tx:#EC9C8C;  /* failed / attention */
  --review:#8FC7CC; --review-bg:#1F464B; --review-tx:#AEDADE; --review-bdr:#3B6E74;

  --hover: rgba(255,255,255,.08);    /* hover state-layer over any surface */

  /* diff lines — live on the ALWAYS-DARK terminal body, constant regardless
     of chrome theme, so keep these fixed */
  --add-bg:rgba(79,155,110,.16); --add-mark:#56C486; --add-tx:#A9D8BC;
  --del-bg:rgba(166,90,77,.20);  --del-mark:#C56F60; --del-tx:#E0B3AB;

  /* additions beyond the spec token list (flagged): */
  --overlay: rgba(0,0,0,.6);         /* modal scrim (kept from the old theme) */
  --bad-rgb: 217,131,111;            /* --bad as rgb channels for glow alpha  */
}
```

- [ ] **Step 5: Create `src/theme/ThemeProvider.tsx`**

```tsx
// ThemeProvider.tsx — brands the root element with the active theme and loads its CSS + fonts.
// Adding a theme later = new tokens file + an entry here; components never change.
import { useEffect, type ReactNode } from "react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./deepSlate.css";

const THEME = "deep-slate"; // single theme for now; the token contract supports more.

export function ThemeProvider({ children }: { children: ReactNode }) {
  // data-theme on <html> so :root[data-theme=…] tokens apply to the whole document (incl. portals).
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", THEME);
  }, []);
  return <>{children}</>;
}
```

Note for the test: the attribute is set in `useEffect`, which testing-library's `render` flushes synchronously under `act` — the assertion right after `render` passes.

- [ ] **Step 6: Wire into `src/main.tsx`**

```tsx
import "./theme/tokens.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "./theme/ThemeProvider";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 7: Run the test, then the suite**

Run: `npx vitest run src/theme/ThemeProvider.test.tsx` → PASS.
Run: `npx vitest run` → all green (nothing else changed yet; old tokens still defined in tokens.css so the UI still renders).

- [ ] **Step 8: Commit**

```bash
git add src/theme/deepSlate.css src/theme/ThemeProvider.tsx src/theme/ThemeProvider.test.tsx src/main.tsx package.json package-lock.json
git commit -m "feat(theme): Deep Slate token file, ThemeProvider, bundled Inter + JetBrains Mono"
```

---

### Task 2: tokens.css → theme-agnostic baseline on the new vocabulary

**Files:**
- Modify: `src/theme/tokens.css`

**Interfaces:**
- Consumes: Deep Slate tokens from Task 1.
- Produces: element baselines (`body`, `button`, inputs, `.icon-btn`) written against `--bg-0/--tx/--bg-3/--bdr/--accent/--on-accent/--hover/--r/--r-sm/--ui`; **all colour token definitions removed** from `:root`.

- [ ] **Step 1: Strip colours, keep layout/type**

`:root` in tokens.css keeps ONLY: `--space-1..6`, `--font-scale`, `--fs-*`. Delete: all colour tokens, `--radius`/`--radius-sm`, `--font-ui`/`--font-mono` (radii + fonts now come from the theme as `--r`/`--r-sm`/`--ui`/`--mono`). Update the file's role comment to say it is the theme-agnostic baseline and that colours live in `deepSlate.css`.

- [ ] **Step 2: Rewrite the element baselines**

Replace the colour-touching rules with (spacing/structure unchanged, hover gains the state layer):

```css
body {
  margin: 0;
  background: var(--bg-0);
  color: var(--tx);
  font-family: var(--ui);
  font-size: var(--fs-md);
  -webkit-font-smoothing: antialiased;
}

button {
  font-family: inherit;
  background: var(--bg-3);
  color: var(--tx);
  border: 1px solid var(--bdr);
  border-radius: var(--r-sm);
  padding: 6px 12px;
  font-size: var(--fs-md);
  cursor: pointer;
  transition: background-color 200ms ease-out, border-color 200ms ease-out, background-image 200ms ease-out;
}
/* hover = --hover state layer over the resting fill (works atop any background-color) */
button:hover:not(:disabled) { background-image: linear-gradient(var(--hover), var(--hover)); border-color: var(--bdr-2); }
button:disabled { opacity: 0.5; cursor: default; }

input:not([type="radio"]):not([type="checkbox"]),
select,
textarea:not(.xterm-helper-textarea) {
  background-color: var(--bg-3);
  color: var(--tx);
  border: 1px solid var(--bdr);
  border-radius: var(--r-sm);
  padding: 6px 8px;
  font-family: var(--ui);
  font-size: var(--fs-md);
}
```

- select chevron data-URI stroke: `%2393A8BA` (= `--tx-2`; data-URIs can't use var() — flagged fixed literal kept in sync with the theme).
- placeholder → `var(--tx-3)`; focus border → `var(--accent)`.
- `.icon-btn`: color `var(--tx-3)`, radius `var(--r-sm)`, hover `color: var(--tx); background: var(--hover);` + the 200ms transition.
- radio accent → `var(--accent)`.
- checkbox: box `var(--bg-3)`/`var(--bdr)`, radius `var(--r-sm)`; checked fill `var(--accent)`; tick data-URI stroke `%230E2135` (= `--on-accent`, flagged same as chevron); focus border `var(--accent)`.

- [ ] **Step 3: Verify the app still builds and tests pass**

Run: `npm run build && npx vitest run` → clean/green. (Component CSS still references old names — they resolve to nothing yet, so the UI is visually broken until Tasks 3–5; that's expected mid-refactor. Tests don't assert colours.)

- [ ] **Step 4: Commit**

```bash
git add src/theme/tokens.css
git commit -m "refactor(theme): tokens.css becomes theme-agnostic baseline on Deep Slate vocabulary"
```

---

### Task 3: App chrome — header roles + overlay titlebar

**Files:**
- Modify: `src/App.css`, `src/App.tsx`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src/views/Modal.css`, `src/views/SettingsModal.css`, `src/views/KnownReposEditor.css` (mechanical renames)

**Interfaces:**
- Consumes: Deep Slate tokens.

- [ ] **Step 1: tauri.conf.json — overlay titlebar + forced dark**

In the window object add:
```json
"titleBarStyle": "Overlay",
"hiddenTitle": true,
"theme": "Dark"
```

- [ ] **Step 2: App.tsx — drag region**

Add `data-tauri-drag-region` to the `<header className="app__header">` element (empty header areas drag the window; buttons inside still receive clicks because the attribute only fires when the header itself is the event target).

- [ ] **Step 3: App.css — roles**

```css
/* App.css — shell: header (brand · segmented switcher · new-worktree) + view body. */
.app { display: flex; flex-direction: column; height: 100vh; }
.app__loading { padding: var(--space-5); color: var(--tx-2); }

/* top bar = --bg-2; left padding clears the macOS traffic lights (overlay titlebar). */
.app__header {
  display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-2) var(--space-3) var(--space-2) 84px;
  border-bottom: 1px solid var(--bdr); background: var(--bg-2);
}
.app__brand { display: flex; align-items: center; gap: var(--space-2); font-weight: 700; color: var(--tx-hi); }

/* view switcher: track --bg-3, ACTIVE TAB = the intentional 2b red. */
.app__segmented { display: flex; gap: 2px; margin: 0 auto; background: var(--bg-3); border: 1px solid var(--bdr); border-radius: var(--r); padding: 2px; }
.app__seg { background: none; border: none; color: var(--tx-2); cursor: pointer; padding: 4px 14px; border-radius: var(--r-sm); font-size: var(--fs-md); transition: color 200ms ease-out, background-color 200ms ease-out; }
.app__seg:hover { color: var(--tx); }
.app__seg--active { background: var(--nav-active); color: var(--tx-hi); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.18); }

/* THE one green button. */
.app__new { background: var(--btn-new); color: var(--on-btn-new); border: none; border-radius: var(--r-sm); padding: 6px 12px; font-weight: 600; cursor: pointer; }
.app__new:hover { background-image: linear-gradient(var(--hover), var(--hover)); }
/* settings gear: neutral icon, not green */
.app__new--icon { display: inline-flex; align-items: center; justify-content: center; font-size: 1.3em; line-height: 1; background: none; color: var(--tx-2); }
.app__new--icon:hover { color: var(--tx); background: var(--hover); }

.app__body { flex: 1; min-height: 0; }
.app__actions { display: flex; align-items: center; gap: var(--space-2); }

/* panes toggle (2/3): workspace-number chips = info trio. */
.app__panes { display: flex; gap: 2px; background: var(--bg-3); border: 1px solid var(--bdr); border-radius: var(--r); padding: 2px; }
.app__pane { background: none; border: none; color: var(--tx-2); cursor: pointer; padding: 4px 10px; border-radius: var(--r-sm); font-size: var(--fs-md); transition: color 200ms ease-out, background-color 200ms ease-out; }
.app__pane:hover { color: var(--tx); }
.app__pane--active { background: var(--info-bg); border: 1px solid var(--info-bdr); color: var(--info-tx); font-weight: 600; padding: 3px 9px; }
```

(`rgba(0,0,0,.18)` shadow is spec'd verbatim for the active tab — flagged allowed literal.)

- [ ] **Step 4: Modal/Settings/KnownRepos CSS — mechanical rename**

Apply the migration table to `Modal.css`, `SettingsModal.css`, `KnownReposEditor.css`. Modal surface = `--bg-1` (panel) with `--bdr-2` outline; scrim stays `var(--overlay)`.

- [ ] **Step 5: Build + eyeball + commit**

Run: `npm run build && npx vitest run` → green.

```bash
git add src/App.css src/App.tsx src-tauri/tauri.conf.json src/views/Modal.css src/views/SettingsModal.css src/views/KnownReposEditor.css
git commit -m "feat(theme): Deep Slate app chrome — red nav tab, green New, info pane chips, overlay titlebar"
```

---

### Task 4: Tiles — Slack, PR Reviews, Todo, Timer, forms

**Files:**
- Modify: `src/tiles/Tile.css`, `src/tiles/slack/slack.css`, `src/tiles/slack/SlackConnections.css`, `src/tiles/pr/pr.css`, `src/tiles/todo/todo.css`, `src/tiles/timer/timer.css`, `src/tiles/worktree/NewWorktreeForm.css`, `src/tiles/worktree/ExistingBranchForm.css`

**Interfaces:**
- Consumes: Deep Slate tokens.

- [ ] **Step 1: Tile.css — card role**

`.tile { background: var(--surface); border: 1px solid var(--bdr-2); border-radius: var(--r); }`; head divider `--divider`; `.tile__title { color: var(--tx-2); }` (drop the opacity-only dimming where it fights the new text ramp — keep opacity on icons).

- [ ] **Step 2: slack.css roles**

Mechanical renames plus:
- `.slack-tile__row:hover { background: var(--hover); transition: background-color 200ms ease-out; }`
- `.slack-tile__name` → channel/DM name = info: `color: var(--info-tx);`
- unread `.slack-tile__badge { background: var(--bad-bg); color: var(--bad-tx); border: 1px solid var(--bad); }` (needs-attention count, per the 2b mock).
- `SlackConnections.css`: `.slack-connections__error { color: var(--bad-tx); }` + table renames.

- [ ] **Step 3: pr.css roles**

- `.pr-tile__repo { color: var(--info-tx); }` (spec: PR repo is info, not accent).
- `.pr-tile__mode` (SHIP/SHOW/ASK) → review trio: `background: var(--review-bg); color: var(--review-tx); border: 1px solid var(--review-bdr);`
- `.pr-tile__review` (primary action) stays accent: `background: var(--accent); border-color: var(--accent); color: var(--on-accent);` hover → `--hover` layer instead of `filter: brightness`.
- `.pr-tile__remove` border `--divider`; row divider `--divider`.

- [ ] **Step 4: todo.css + timer.css**

Mechanical renames plus status roles: in-progress glyph/label `--warn`; done `--ok`; `.timer__time--done { color: var(--warn-tx); }`. Timer digits use `font-family: var(--mono)` if they don't already.

- [ ] **Step 5: Form CSS**

`NewWorktreeForm.css` / `ExistingBranchForm.css`: mechanical renames; `__error` → `color: var(--bad-tx);`; primary Create buttons → `--accent`/`--on-accent` (green is reserved for the header `+ New`).

- [ ] **Step 6: Build/tests + commit**

Run: `npm run build && npx vitest run` → green.

```bash
git add src/tiles
git commit -m "feat(theme): Deep Slate tile roles — info names, review-mode badges, status trios"
```

---

### Task 5: Views + worktree column + diff area

**Files:**
- Modify: `src/views/WorktreesView.css`, `src/views/CockpitView.css`, `src/views/worktree-column/WorktreeColumn.css`, `src/views/worktree-column/WorktreePane.css`

**Interfaces:**
- Consumes: Deep Slate tokens + fixed §3 literals (diff area only).

- [ ] **Step 1: WorktreesView.css / column chrome**

Mechanical renames; column panels sit on `--bg-1`; column headers `--bg-2`; dividers `--divider`.

- [ ] **Step 2: WorktreeColumn.css roles**

- Chips → info trio: `.wt-chip { background: var(--info-bg); border: 1px solid var(--info-bdr); color: var(--info-tx); }` (check the actual current chip rule at lines 54–58 and preserve its layout properties). Markers: `.wt-chip::before { background: var(--info-tx); }`, `--linear`/`--pr`/`--issue` markers all `var(--info-tx)` (kind is still distinguished by the square-vs-dot shape); `--link`/localhost markers `var(--tx-3)`; delete the `--pr` colour dependency.
- `.wt-chip:not(:disabled):hover { color: var(--tx); border-color: var(--accent); }`
- Attention: `.wt-col__icon--attention { background: var(--bad); }`; `.wt-attention { color: var(--bg-0); background: var(--bad); border-radius: var(--r-sm); }`
- Danger rows: `.wt-col__danger`, `.tc__warn`, `.tc__error` → `var(--bad-tx)`; `.tc__error` surface `var(--bg-3)` border `var(--bdr)`.
- Status dot for a running worktree: `--ok` with the pulsing animation if one exists; check current rule and map running/ok → `--ok`, attention → `--bad`.

- [ ] **Step 3: WorktreePane.css — terminal card + glow**

- `.wt-pane { background: var(--surface); border: 1px solid var(--bdr); }`
- Attention glow: `border-color: var(--bad); box-shadow: 0 0 0 1px var(--bad), 0 0 24px 5px rgba(var(--bad-rgb), 0.45);`
- Header (chrome): `background: var(--surface); color: var(--tx-2); border-bottom: 1px solid var(--divider);` — header is chrome, body is fixed dark:
- `.wt-pane__body { background: var(--term); }` (the always-dark terminal ground).
- `.wt-ico { background: var(--tx-2); }`

- [ ] **Step 4: CockpitView.css — tabs + diff code area**

- Tab bar: active tab underline/text `--accent`; inactive `--tx-2` (mechanical rename of whatever the current `.cockpit-view__tab*` rules use).
- File-list stats: `.wt-diff__add { color: var(--add-mark); }` `.wt-diff__del { color: var(--del-mark); }`
- Diff code area = always-dark: give the diff line container `background: var(--term); font-family: var(--mono);` and:

```css
/* diff code area — ALWAYS-DARK surface: fixed §3 literals + the fixed --add/--del tokens. */
.wt-diff__line--hunk { color: #8fb6e0; background: rgba(143,182,224,.08); }
.wt-diff__line--add { color: var(--add-tx); background: var(--add-bg); }
.wt-diff__line--del { color: var(--del-tx); background: var(--del-bg); }
```

(Context lines `#9aa3b2` if a colour is currently set for them; otherwise leave inheriting.)

- [ ] **Step 5: Build/tests + commit**

Run: `npm run build && npx vitest run` → green.

```bash
git add src/views
git commit -m "feat(theme): Deep Slate views — info chips, bad-attention glow, fixed dark diff area"
```

---

### Task 6: xterm fixed dark theme + mono font

**Files:**
- Modify: `src/worktrees/useTerminal.ts:34` (Terminal construction)

**Interfaces:**
- Produces: `TERM_THEME` const (xterm `ITheme`), applied to every terminal.

- [ ] **Step 1: Add the fixed theme constant and apply it**

Above the hook (next to `TERM_BASE_FONT`):

```ts
// Fixed always-dark terminal palette (spec §3) — deliberately NOT chrome tokens: terminal bodies
// stay this exact dark set even if a light chrome theme is added later.
const TERM_THEME = {
  background: "#0E1F2D",
  foreground: "#9aa3b2",
  cursor: "#e7ebf2",
  cursorAccent: "#0E1F2D",
  selectionBackground: "rgba(143,182,224,0.25)",
  black: "#3a4a5e",        // line-number grey
  red: "#ff7b72",          // keyword red
  green: "#5FB584",
  yellow: "#C1A46E",       // camel
  blue: "#79c0ff",         // number blue
  magenta: "#d2a8ff",      // fn purple
  cyan: "#a5d6ff",         // string blue
  white: "#9aa3b2",
  brightBlack: "#6a7a8c",  // comment
  brightRed: "#C56F60",    // attention ⚠
  brightGreen: "#5FB584",
  brightYellow: "#C1A46E",
  brightBlue: "#8fb6e0",   // paths / branch
  brightMagenta: "#d2a8ff",
  brightCyan: "#a5d6ff",
  brightWhite: "#e7ebf2",  // bright text
};
```

Change the construction:

```ts
const term = new Terminal({
  convertEol: false,
  fontSize: termFontSize(useSettings.getState().fontScale),
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  theme: TERM_THEME,
});
```

- [ ] **Step 2: Build/tests + commit**

Run: `npm run build && npx vitest run` → green.

```bash
git add src/worktrees/useTerminal.ts
git commit -m "feat(theme): fixed always-dark xterm palette + JetBrains Mono"
```

---

### Task 7: Sweep, verify, visual smoke

**Files:** none new — verification + fixes.

- [ ] **Step 1: Old-token grep must be empty**

```bash
grep -rnE 'var\(--(bg|surface-raised|overlay-old|border|border-subtle|text|text-secondary|text-muted|accent-fg|attention|attention-warm|attention-warm-rgb|danger|info|pr|git|diff-add|diff-del|radius|radius-sm|font-ui|font-mono)[),]' src --include='*.css' --include='*.tsx' --include='*.ts'
```
Expected: no matches (note `--bg-0/--bg-1…` and `--accent`/`--accent-strong` are fine — the pattern's `[),]` boundary excludes them; double-check any hit by eye). Fix stragglers.

- [ ] **Step 2: Literal-colour audit → flag list**

```bash
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(' src --include='*.css' --include='*.tsx' --include='*.ts' | grep -v deepSlate.css | grep -v test
```
Every hit must be one of the allowed fixed sets (useTerminal TERM_THEME, diff hunk literals, data-URI chevron/tick, active-tab shadow, `rgba(var(--bad-rgb)…)`, Claude brand `#D97757`). Anything else: fix or flag in the final report.

- [ ] **Step 3: Full verification**

Run: `npm run build && npx vitest run` → clean + all green.
Run: `cd src-tauri && cargo build` → clean (config-only change, still verify).

- [ ] **Step 4: Visual smoke (tauri dev + screenshot)**

Run `npm run tauri dev` in the background; once the window is up, capture it with macOS `screencapture` and eyeball: red active tab, green + New, info chips, dark terminal bodies with Inter chrome, traffic lights clear of content.

- [ ] **Step 5: Commit any sweep fixes**

```bash
git add -A && git commit -m "chore(theme): Deep Slate sweep — retire old token names, flag fixed literals"
```

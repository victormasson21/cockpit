# Publish readiness

> Audit date: **2026-09-03**, against `main` at `02d90ad` (v0.2.11).
> Scope: what blocks Cockpit from being published — as a public repo, or as a
> downloadable app. Findings only. Nothing here is fixed yet.
>
> Cockpit works. The gap is distribution, not the code. Four findings leak
> private data or prevent legal use. Fix those before anything else.

Each finding states the fact, the evidence, and the fix. Priority order runs
top to bottom within each section.

---

## Blockers — leaks and licence

Fix all four before the repo becomes public.

### B1. The lockfile routes every dependency through an internal proxy

`package-lock.json` resolves all packages via `https://nexus.elder.org/…` —
an employer-internal npm mirror.

```
$ grep -c "nexus.elder.org" package-lock.json    → 167
$ grep -c "registry.npmjs.org" package-lock.json  → 0
```

Two consequences. The hostname is published. `npm ci` fails for anyone off
that network, because npm fetches the `resolved` URLs.

**Fix:**
1. Regenerate the lockfile against the public registry:
   `npm install --registry=https://registry.npmjs.org --package-lock-only`.
2. Commit an `.npmrc` that pins `registry=https://registry.npmjs.org`, so the
   internal URLs cannot return.
3. Decide whether the public repo starts from a fresh history — the URLs are in
   past commits too.

### B2. Both README screenshots contain real private data

`docs/assets/cockpit-view.png` shows internal Slack channels (`sentry-issues`,
`product`, `auth0-sms-dev`), **a phone number in an SMS preview**
(`+4498990002111`), internal repositories (`et-web-portal`,
`customer-web-portal`), `@elder/et-facade-*` packages, a colleague's first
name, and a real pull-request title about billing.

`docs/assets/current-state.png` shows `linear.app/elder/issue/ENG-1857`,
ticket `ENG-1562`, internal product detail (Xero, Finance, overdue balance),
and internal source paths.

**Fix:** re-shoot both screenshots against dummy repositories and a dummy
Slack workspace. Do not retouch — the terminals hold real content too.

### B3. No licence

The repository has no `LICENSE` file. Default copyright therefore applies.
Nobody may legally fork, use, or redistribute it.

**Fix:**
1. Add a `LICENSE` file. MIT or Apache-2.0 both suit a personal tool.
2. Add a `NOTICE` file for bundled third-party assets. Inter and JetBrains Mono
   ship inside the app via `@fontsource`, and the SIL Open Font License requires
   their licence text to travel with them.
3. Keep the existing OpenStreetMap and TfL attribution in `README.md`. It already
   meets both licences.

### B4. Design docs use internal example names

Five files under `docs/superpowers/` use `elder-api` or `customer-web-portal`
as worked examples. Ticket references `ENG-1558` and `ENG-2841` read as real.

**Fix:** replace the names with neutral placeholders. Low harm, quick to do.

---

## Onboarding — the largest functional gap

Cockpit assumes its author is the user. A stranger cannot set it up from the
README alone.

### O1. No first-run experience

The app has no welcome step, no setup checklist, and no empty-state guidance.
A new user sees empty columns and an empty Settings modal. Requirements surface
only as errors: `no known repos configured`, then `claude CLI not found`.

**Fix:** add a setup pane to Settings. Probe for each prerequisite and show a
pass or fail row per item. This gives most of the value for little code.

### O2. Hard prerequisites are undocumented

Cockpit needs the `claude` CLI, an authenticated `gh`, and `git`. The README
mentions none of them. `shell_env.rs` exists only to make the first two resolve
on GUI launch.

Deduce, every Claude pane, the GitHub source type, and the `+ PR` chip all fail
without them.

**Fix:** list the prerequisites in `README.md`, above the setup steps. State the
version each was verified against.

### O3. Slack setup is under-specified, and one port range is wrong

The README asks the user to add "the User Token Scopes the tile needs (read
channels/messages)". The code needs an exact string
(`slack.rs`, `SCOPES`):

```
channels:read,channels:history,groups:read,groups:history,
im:read,im:history,mpim:read,mpim:history,users:read
```

A latent bug sits beside it. `slack_connect` binds the first free port in
**9000–9009** and sends that port as `redirect_uri`. The README tells the user
to register only `:9000`. Slack matches the redirect URI exactly. If port 9000
is busy, OAuth fails with an unhelpful Slack error.

**Fix:**
1. Publish the exact scope string.
2. Either tell the user to register all ten redirect URLs, or bind port 9000
   only and fail with a clear message when it is busy.

### O4. Remaining onboarding items

- The attention highlight needs a hand-edit of `~/.claude/settings.json`. This is
  documented, but manual, and silent when absent.
- The worktree root is hardcoded to `~/CockpitWorktrees`. Add a setting.
- The default config still ships dead `clock-1` and `notes-1` tiles. No registry
  renders them. Remove them from `CockpitConfig::default`.

---

## Packaging — no distributable exists

Do this work only if you want users to download a build. Source-available needs
none of it.

### P1. No code signing and no notarisation

`tauri.conf.json` has no `bundle.macOS` block. Any DMG therefore fails
Gatekeeper on another Mac.

**Fix:** obtain a Developer ID Application certificate, sign the bundle, and
notarise it with `notarytool`. As a stopgap, document
`xattr -dr com.apple.quarantine /Applications/cockpit.app`.

### P2. No auto-update

`tauri-plugin-updater` is absent. You cannot ship a fix to anyone who has
downloaded a build.

### P3. Apple Silicon only

The build targets the host architecture. Add
`--target universal-apple-darwin` for an Intel-compatible bundle.

### P4. Placeholder bundle metadata

`src-tauri/Cargo.toml` still reads `description = "A Tauri App"` and
`authors = ["you"]`. `tauri.conf.json` has no copyright, category, or
`minimumSystemVersion`.

### P5. No continuous integration

The repository has no `.github/` directory. Both test suites exist — Vitest for
the frontend, `cargo test` for the core — and nothing runs them on push.

Releases run through the `/cockpit-release` command, which hardcodes
`/Users/victormasson/Repos/perso/cockpit`. There is no CHANGELOG and no GitHub
Release.

**Fix:** add one workflow that runs both test suites on push, and one that
builds a signed DMG on tag.

---

## Safety

### S1. The Slack OAuth flow has no CSRF `state` parameter

`authorize_url` omits `state`. The loopback server accepts any request on its
port for about two minutes, and never checks that it started the flow.

Risk is low for a single user. It is not low for published software. Sub-project
5 will copy this template for Linear, so harden it once, now.

*Already tracked in `ROADMAP.md` → Integrations / Slack.*

### S2. `bypassPermissions` on the Slack deduce path

`deduce.rs:329` sets `--permission-mode bypassPermissions`. The
`--allowedTools mcp__slack` filter scopes it to Slack tools.

The bypass was needed because the Slack connector gates its tool calls even when
allow-listed. Linear needs no bypass.

**Fix:** re-test whether the bypass is still required. If it is, document it
prominently — the same path reads Slack content that Cockpit does not control.

### S3. A prompt can reach a shell command

The deduce agent proposes `startCmd` from a repository's README and scripts.
`with_install` prepends `<pm> install &&`. The ▶ Run button then types the
result into a login shell (`pty.rs:103`).

A click gates it, and the shell echoes the line into the pane. The user cannot
read the command *before* running it — only a tooltip shows it.

**Fix:** show the resolved command on the Run control.

### S4. No content-security policy

`tauri.conf.json` sets `"csp": null`. The webview loads local assets only,
except the London Underground background, which fetches `api.tfl.gov.uk`.

**Fix:** set `default-src 'self'` plus one `connect-src` for that host.

### S5. No privacy statement

Three things leave the machine. Repository digests — `package.json` fields plus
800 characters of README — go to Anthropic through the `claude` CLI. Slack and
Linear content passes through the CLI's MCP connectors. The London Underground
background polls TfL.

All three are reasonable. None is disclosed in one place.

**Fix:** add a "What leaves your machine" section to `README.md`.

### S6. No logs and no crash reporting

Errors surface inline in the UI and nowhere else. You cannot triage a bug report
from a user you cannot sit beside.

### Verified safe

Checked, and no change needed:

- `slug()` blocks path traversal. It maps every non-alphanumeric character to a
  dash, so `..` cannot survive.
- All git arguments pass through `Command::args`. No shell interprets them, so
  argument injection is not possible.
- The Keychain holds the Slack user token and the client secret. `cockpit.json`
  never holds a secret.
- Force-delete paths (`git worktree remove --force`, `git branch -D`) sit behind
  the teardown confirm dialog.

---

## Recommended order

1. Fix B1–B4. Half a day. This unblocks a public repository.
2. Fix O2 and O3. The README then describes a setup that works.
3. Fix S1, S3, and S4. Each is small, and each matters more once strangers run it.
4. Add P5, then P1. Only needed for a downloadable build.
5. Build O1 last. It is the largest piece, and the least urgent.

Publish as **source-available, build-it-yourself** after step 2. That is a real
milestone, and it avoids Gatekeeper and auto-update entirely while you decide
whether you want users.

// useTerminal.ts — binds one xterm.js instance to one Rust PTY: ensure -> attach (replay) -> stream -> input/resize.
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { makePtyId, isAttentionRole } from "./ptyId";
import { useSettings } from "../settings/store";

export interface UseTerminalArgs {
  worktreeId: string;
  role: string;
  cwd: string;
  autostartCmd?: string;
  onEnsured?: () => void; // fires after the mount-time pty_ensure resolves (one-shot autostart consumption)
}

// The xterm base font size at 100% zoom; multiplied by the store's fontScale so terminals zoom too.
const TERM_BASE_FONT = 12;
const termFontSize = (scale: number) => Math.round(TERM_BASE_FONT * scale);

// Fixed always-dark terminal palette (theme spec §3) — deliberately NOT chrome tokens: terminal
// bodies keep this exact dark set even if a light chrome theme is added later.
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

// Mount an xterm into a div and keep it attached to the (worktree, role) PTY for the component's lifetime.
export function useTerminal({ worktreeId, role, cwd, autostartCmd, onEnsured }: UseTerminalArgs) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ptyIdRef = useRef<string>(makePtyId(worktreeId, role));
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // autostartCmd/onEnsured live in refs: a post-mount change (the one-shot prompt being consumed)
  // must NOT dispose/recreate the terminal — pty_ensure is idempotent, so re-running was pointless.
  const autostartRef = useRef(autostartCmd);
  autostartRef.current = autostartCmd;
  const onEnsuredRef = useRef(onEnsured);
  onEnsuredRef.current = onEnsured;
  const fontScale = useSettings((s) => s.fontScale);

  useEffect(() => {
    const ptyId = makePtyId(worktreeId, role);
    ptyIdRef.current = ptyId;
    // Mount at the current zoom; a separate effect reflows on later zoom changes without remounting.
    const term = new Terminal({
      convertEol: false,
      scrollback: 10000, // Claude sessions blow past xterm's 1000-line default
      fontSize: termFontSize(useSettings.getState().fontScale),
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      theme: TERM_THEME,
    });
    termRef.current = term;
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    // Unicode 11 width tables: match Claude Code's assumption that emoji/wide glyphs are width-2,
    // so its box-drawing UI and input box stay aligned. Must be set before term.open().
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = "11";
    term.open(containerRef.current!);
    // GPU renderer for smooth streaming/spinner redraws across many live panes. Best-effort:
    // on context loss (or if WebGL is unavailable) dispose so xterm falls back to the DOM renderer.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* WebGL unavailable in this webview — xterm keeps its DOM renderer */
    }
    // Cmd+click URLs Claude prints (PRs, docs, localhost previews) → open in the real browser.
    term.loadAddon(new WebLinksAddon((_event, uri) => { void openUrl(uri); }));
    fit.fit();

    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    // Attention highlight (claude pane + scratch shells only): a terminal bell from Claude Code
    // means "I need you". `armed` gates out BEL bytes already sitting in replayed scrollback.
    const armed = isAttentionRole(role);
    let bellLive = false;
    const onBell = armed
      ? term.onBell(() => { if (bellLive) useSettings.getState().markAttention(ptyId); })
      : undefined;

    // ensure the PTY exists, replay its scrollback, then live-stream new output.
    // A failed spawn (e.g. missing worktree path / bad shell) rejects here and is shown in-pane (spec §G).
    (async () => {
      try {
        await invoke("pty_ensure", {
          worktreeId, role, cwd, autostartCmd: autostartRef.current, cols: term.cols, rows: term.rows,
        });
        onEnsuredRef.current?.(); // autostart consumed (or PTY already alive) — callers clear one-shot flags here
        const scrollback = await invoke<number[]>("pty_attach", { ptyId });
        if (disposed) return;
        term.write(new Uint8Array(scrollback));
        bellLive = true; // replay done — bells from here on are live and meaningful.
        unlisten = await listen<number[]>(`pty://${ptyId}`, (e) => term.write(new Uint8Array(e.payload)));
      } catch (e) {
        if (!disposed) term.write(`\r\n[failed to start: ${String(e)}]\r\n`);
      }
    })();

    // Clear the highlight only when the user actually types into the pane — i.e. they've started
    // responding to Claude. (NOT on focus/window-switch: that would clear before they notice it.)
    const onData = term.onData((data) => {
      if (armed) useSettings.getState().clearAttention(ptyId);
      invoke("pty_write", { ptyId, bytes: Array.from(new TextEncoder().encode(data)) });
    });
    const onResize = term.onResize(({ cols, rows }) => invoke("pty_resize", { ptyId, cols, rows }));
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(containerRef.current!);

    // detach (do NOT kill): switching worktrees leaves the process running in the background.
    return () => {
      disposed = true;
      termRef.current = null;
      fitRef.current = null;
      unlisten?.();
      onBell?.dispose();
      onData.dispose();
      onResize.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [worktreeId, role, cwd]);

  // Live zoom: update xterm's font size and refit (onResize -> pty_resize handles the PTY). No remount,
  // so scrollback and the running process are untouched. Skips the initial mount (already sized above).
  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    term.options.fontSize = termFontSize(fontScale);
    fit.fit();
  }, [fontScale]);

  // Kill then re-ensure at the terminal's CURRENT size. `cmd` decides what comes back:
  // restart re-runs the role's autostart; close respawns a BARE shell (a dead pane with no
  // process behind it silently eats keystrokes — pty_write fails on the missing id).
  const respawn = (cmd: string | undefined, label: string) => {
    const ptyId = ptyIdRef.current;
    const term = termRef.current;
    const cols = term?.cols ?? 80;
    const rows = term?.rows ?? 24;
    useSettings.getState().clearAttention(ptyId); // a manual restart/close resets any pending highlight.
    invoke("pty_kill", { ptyId })
      .then(() => invoke("pty_ensure", { worktreeId, role, cwd, autostartCmd: cmd, cols, rows }))
      .catch((e) => term?.write(`\r\n[${label} failed: ${String(e)}]\r\n`));
  };
  // restart reads the ref so it picks up the current autostart (e.g. plain `claude` after the one-shot prompt).
  const restart = () => respawn(autostartRef.current, "restart");
  // close: cut off whatever is running (autostart cmd AND its shell), land on a fresh empty prompt.
  const close = () => respawn(undefined, "close");

  return { containerRef, restart, close };
}

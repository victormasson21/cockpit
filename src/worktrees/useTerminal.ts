// useTerminal.ts — binds one xterm.js instance to one Rust PTY: ensure -> attach (replay) -> stream -> input/resize.
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
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
}

// Mount an xterm into a div and keep it attached to the (worktree, role) PTY for the component's lifetime.
export function useTerminal({ worktreeId, role, cwd, autostartCmd }: UseTerminalArgs) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ptyIdRef = useRef<string>(makePtyId(worktreeId, role));
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const ptyId = makePtyId(worktreeId, role);
    ptyIdRef.current = ptyId;
    const term = new Terminal({ convertEol: false, fontSize: 12 });
    termRef.current = term;
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current!);
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
          worktreeId, role, cwd, autostartCmd, cols: term.cols, rows: term.rows,
        });
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
      unlisten?.();
      onBell?.dispose();
      onData.dispose();
      onResize.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [worktreeId, role, cwd, autostartCmd]);

  // restart: kill then re-ensure (re-runs autostart) at the terminal's CURRENT size for a wedged process.
  const restart = () => {
    const ptyId = ptyIdRef.current;
    const term = termRef.current;
    const cols = term?.cols ?? 80;
    const rows = term?.rows ?? 24;
    useSettings.getState().clearAttention(ptyId); // a manual restart resets any pending highlight.
    invoke("pty_kill", { ptyId })
      .then(() => invoke("pty_ensure", { worktreeId, role, cwd, autostartCmd, cols, rows }))
      .catch((e) => term?.write(`\r\n[restart failed: ${String(e)}]\r\n`));
  };

  return { containerRef, restart };
}

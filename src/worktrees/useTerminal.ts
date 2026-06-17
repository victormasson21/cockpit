// useTerminal.ts — binds one xterm.js instance to one Rust PTY: ensure -> attach (replay) -> stream -> input/resize.
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

export interface UseTerminalArgs {
  worktreeId: string;
  role: string;
  cwd: string;
  autostartCmd?: string;
}

// Mount an xterm into a div and keep it attached to the (worktree, role) PTY for the component's lifetime.
export function useTerminal({ worktreeId, role, cwd, autostartCmd }: UseTerminalArgs) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ptyIdRef = useRef<string>(`${worktreeId}:${role}`);

  useEffect(() => {
    const ptyId = `${worktreeId}:${role}`;
    ptyIdRef.current = ptyId;
    const term = new Terminal({ convertEol: false, fontSize: 12 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current!);
    fit.fit();

    let unlisten: UnlistenFn | undefined;
    let disposed = false;

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
        unlisten = await listen<number[]>(`pty://${ptyId}`, (e) => term.write(new Uint8Array(e.payload)));
      } catch (e) {
        if (!disposed) term.write(`\r\n[failed to start: ${String(e)}]\r\n`);
      }
    })();

    const onData = term.onData((data) =>
      invoke("pty_write", { ptyId, bytes: Array.from(new TextEncoder().encode(data)) })
    );
    const onResize = term.onResize(({ cols, rows }) => invoke("pty_resize", { ptyId, cols, rows }));
    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(containerRef.current!);

    // detach (do NOT kill): switching worktrees leaves the process running in the background.
    return () => {
      disposed = true;
      unlisten?.();
      onData.dispose();
      onResize.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [worktreeId, role, cwd, autostartCmd]);

  // restart: kill then re-ensure for a wedged process.
  const restart = () => {
    const ptyId = ptyIdRef.current;
    invoke("pty_kill", { ptyId }).then(() =>
      invoke("pty_ensure", { worktreeId, role, cwd, autostartCmd, cols: 80, rows: 24 })
    );
  };

  return { containerRef, restart };
}

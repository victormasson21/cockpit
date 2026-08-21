// ptyPane.ts — the typed PTY IPC surface: one pane's control handle, keyed by (worktreeId, role).
// Owns the three conventions that used to travel with the call sites: the id format, the pty://
// event topic, and the string -> UTF-8 bytes conversion. Deliberately store-free, so it stays
// substitutable in tests — the sequences that need the store live in paneLifecycle.ts.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { makePtyId } from "./ptyId";

// What pty_ensure needs to (re)spawn: where to run, what to autostart, and the pane's current size.
export type EnsureOpts = { cwd: string; autostartCmd?: string; cols: number; rows: number };

// Hoisted: onData writes one of these per keystroke, and a fresh encoder per call was pure waste.
const encoder = new TextEncoder();

// Writes return their promise rather than swallowing, so each caller keeps its own error handling
// (the terminal hot paths deliberately have none; the file drop has a .catch).
export const writePty = (ptyId: string, text: string): Promise<void> =>
  invoke("pty_write", { ptyId, bytes: Array.from(encoder.encode(text)) });

// Registry-wide query, so it belongs beside the per-pane handle rather than on it: which PTYs are
// actually running right now. Powers the slot picker's activity marker; see activity.ts.
export const ptyLiveIds = (): Promise<string[]> => invoke<string[]>("pty_live_ids");

export interface PtyPane {
  readonly id: string; // also the attention-map key and the pane body's data-pty-id
  ensure(opts: EnsureOpts): Promise<string>;
  attach(): Promise<Uint8Array>;
  onOutput(onBytes: (bytes: Uint8Array) => void): Promise<UnlistenFn>;
  write(text: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  kill(): Promise<void>;
  respawn(opts: EnsureOpts): Promise<string>;
}

export function ptyPane(worktreeId: string, role: string): PtyPane {
  const ptyId = makePtyId(worktreeId, role);
  const ensure = ({ cwd, autostartCmd, cols, rows }: EnsureOpts) =>
    invoke<string>("pty_ensure", { worktreeId, role, cwd, autostartCmd, cols, rows });
  const kill = () => invoke<void>("pty_kill", { ptyId });
  return {
    id: ptyId,
    ensure,
    attach: async () => new Uint8Array(await invoke<number[]>("pty_attach", { ptyId })),
    onOutput: (onBytes) => listen<number[]>(`pty://${ptyId}`, (e) => onBytes(new Uint8Array(e.payload))),
    write: (text) => writePty(ptyId, text),
    resize: (cols, rows) => invoke<void>("pty_resize", { ptyId, cols, rows }),
    kill,
    // The kill MUST complete before the ensure: pty_ensure reattaches a still-alive entry, so a
    // lagging kill would land after the respawn and remove the pane we just brought back.
    respawn: async (opts) => {
      await kill();
      return ensure(opts);
    },
  };
}

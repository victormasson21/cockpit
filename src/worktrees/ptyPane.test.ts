// ptyPane.test.ts — the conventions the module now owns: id format, pty:// topic, UTF-8 encoding,
// and respawn's kill-before-ensure ordering.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Ordered log so respawn's sequence is assertable, plus the raw args for the payload assertions.
const calls: { cmd: string; args: Record<string, unknown> }[] = [];
const listeners: ((e: { payload: number[] }) => void)[] = [];
let killFails = false;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "pty_kill" && killFails) return Promise.reject("kill boom");
    if (cmd === "pty_attach") return Promise.resolve([104, 105]); // "hi"
    return Promise.resolve("wt-1:claude");
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((topic: string, cb: (e: { payload: number[] }) => void) => {
    calls.push({ cmd: "listen", args: { topic } });
    listeners.push(cb);
    return Promise.resolve(() => calls.push({ cmd: "unlisten", args: {} }));
  }),
}));

import { ptyPane, writePty } from "./ptyPane";
import { NEWLINE_ESCAPE } from "./keys";

const names = () => calls.map((c) => c.cmd);
const argsOf = (cmd: string) => calls.find((c) => c.cmd === cmd)?.args;

beforeEach(() => {
  calls.length = 0;
  listeners.length = 0;
  killFails = false;
});

describe("ptyPane", () => {
  it("composes the pty id from (worktreeId, role)", () => {
    expect(ptyPane("wt-1", "shell-2").id).toBe("wt-1:shell-2");
  });

  it("ensure passes the pair and the spawn options", async () => {
    await ptyPane("wt-1", "host").ensure({ cwd: "/wt", autostartCmd: "npm run dev", cols: 100, rows: 30 });
    expect(argsOf("pty_ensure")).toEqual({
      worktreeId: "wt-1", role: "host", cwd: "/wt", autostartCmd: "npm run dev", cols: 100, rows: 30,
    });
  });

  it("attach returns the scrollback as bytes", async () => {
    const bytes = await ptyPane("wt-1", "claude").attach();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([104, 105]);
    expect(argsOf("pty_attach")).toEqual({ ptyId: "wt-1:claude" });
  });

  it("onOutput subscribes to the pane's pty:// topic and hands over bytes", async () => {
    const seen: Uint8Array[] = [];
    await ptyPane("wt-1", "claude").onOutput((b) => seen.push(b));
    expect(argsOf("listen")).toEqual({ topic: "pty://wt-1:claude" });
    listeners[0]({ payload: [65, 66] });
    expect(Array.from(seen[0])).toEqual([65, 66]);
  });

  it("write encodes text as UTF-8 bytes", async () => {
    await ptyPane("wt-1", "claude").write("ls\r");
    expect(argsOf("pty_write")).toEqual({ ptyId: "wt-1:claude", bytes: [108, 115, 13] });
  });

  // The keystroke path must not mangle anything the user pastes or types.
  it("write encodes multi-byte characters by byte, not by character", async () => {
    await writePty("wt-1:claude", "é🌳");
    expect(argsOf("pty_write")?.bytes).toEqual([195, 169, 240, 159, 140, 179]);
  });

  it("write sends Shift+Enter's escape as the same two bytes it always was", async () => {
    await ptyPane("wt-1", "claude").write(NEWLINE_ESCAPE);
    expect(argsOf("pty_write")?.bytes).toEqual([92, 13]);
  });

  it("resize and kill address the pane by id", async () => {
    const pane = ptyPane("wt-1", "claude");
    await pane.resize(120, 40);
    await pane.kill();
    expect(argsOf("pty_resize")).toEqual({ ptyId: "wt-1:claude", cols: 120, rows: 40 });
    expect(argsOf("pty_kill")).toEqual({ ptyId: "wt-1:claude" });
  });

  // The whole reason respawn exists: pty_ensure reattaches a still-alive entry, so a lagging kill
  // would remove the pane we just brought back.
  it("respawn kills before it ensures", async () => {
    await ptyPane("wt-1", "host").respawn({ cwd: "/wt", autostartCmd: "npm run dev", cols: 80, rows: 24 });
    expect(names()).toEqual(["pty_kill", "pty_ensure"]);
  });

  it("respawn does not ensure when the kill fails", async () => {
    killFails = true;
    await expect(
      ptyPane("wt-1", "host").respawn({ cwd: "/wt", cols: 80, rows: 24 }),
    ).rejects.toBe("kill boom");
    expect(names()).toEqual(["pty_kill"]);
  });
});

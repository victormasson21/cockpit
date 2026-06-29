// ptyId.test.ts — PTY id format + which roles arm the attention highlight.
import { describe, it, expect } from "vitest";
import { makePtyId, isAttentionRole } from "./ptyId";

describe("ptyId", () => {
  it("makePtyId joins worktree id and role with a colon", () => {
    expect(makePtyId("wt-1", "claude")).toBe("wt-1:claude");
    expect(makePtyId("scratch-2", "shell")).toBe("scratch-2:shell");
  });

  it("isAttentionRole is true only for claude panes and scratch shells", () => {
    expect(isAttentionRole("claude")).toBe(true);
    expect(isAttentionRole("shell")).toBe(true);
    expect(isAttentionRole("host")).toBe(false);
    expect(isAttentionRole("git")).toBe(false);
  });
});

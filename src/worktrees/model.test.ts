// model.test.ts — pure worktree helpers (existing link reducers + ticket link construction from a deduction).
import { describe, it, expect } from "vitest";
import { makeWorktree, addLink, updateLink, removeLink, ticketLinkFrom } from "./model";
import type { DeducedWorktree } from "./api";

describe("makeWorktree", () => {
  it("defaults status to ongoing and links to empty", () => {
    const wt = makeWorktree({
      id: "wt-1", name: "fix login", repoPath: "/r", branch: "b",
      worktreePath: "/wt", host: { startCmd: "npm run dev", address: "http://localhost:3000" },
    });
    expect(wt.status).toBe("ongoing");
    expect(wt.links).toEqual([]);
    expect(wt.name).toBe("fix login");
  });
});

describe("links reducers", () => {
  const base = [{ label: "Ticket", url: "u1" }];
  it("addLink appends", () => {
    expect(addLink(base, { label: "Design", url: "u2" })).toHaveLength(2);
  });
  it("updateLink patches by index", () => {
    expect(updateLink(base, 0, { url: "u9" })[0]).toEqual({ label: "Ticket", url: "u9" });
  });
  it("removeLink drops by index", () => {
    expect(removeLink(base, 0)).toEqual([]);
  });
  it("does not mutate the input array", () => {
    addLink(base, { label: "X", url: "y" });
    expect(base).toHaveLength(1);
  });
});

const deducedBase: DeducedWorktree = {
  repoPath: "/r", name: "n", branch: "b", base: "main", startCmd: "c", address: "a", reason: "r",
};

describe("ticketLinkFrom", () => {
  it("returns null when there is no ticket url", () => {
    expect(ticketLinkFrom(deducedBase)).toBeNull();
  });
  it("uses the ticket title as the link label", () => {
    expect(ticketLinkFrom({ ...deducedBase, ticketUrl: "https://linear.app/x", ticketTitle: "Fix login" }))
      .toEqual({ label: "Fix login", url: "https://linear.app/x" });
  });
  it("falls back to the url when there is no title", () => {
    expect(ticketLinkFrom({ ...deducedBase, ticketUrl: "https://linear.app/x" }))
      .toEqual({ label: "https://linear.app/x", url: "https://linear.app/x" });
  });
});

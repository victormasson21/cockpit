// model.test.ts — pure worktree helpers (existing link reducers + source link construction from a deduction).
import { describe, it, expect } from "vitest";
import { makeWorktree, addLink, updateLink, removeLink, sourceLinkFrom, prLinkToAdd, branchSpecFrom, FORM_DEFAULTS } from "./model";
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

describe("sourceLinkFrom", () => {
  it("returns null when there is no source url", () => {
    expect(sourceLinkFrom(deducedBase)).toBeNull();
  });
  it("uses the source title as the link label", () => {
    expect(sourceLinkFrom({ ...deducedBase, sourceUrl: "https://linear.app/x", sourceTitle: "Fix login" }))
      .toEqual({ label: "Fix login", url: "https://linear.app/x" });
  });
  it("falls back to the url when there is no title", () => {
    expect(sourceLinkFrom({ ...deducedBase, sourceUrl: "https://linear.app/x" }))
      .toEqual({ label: "https://linear.app/x", url: "https://linear.app/x" });
  });
});

describe("prLinkToAdd", () => {
  const pr = { number: 42, url: "https://github.com/elder/cockpit/pull/42" };
  it("builds a PR link when the url isn't already present", () => {
    expect(prLinkToAdd([], pr)).toEqual({ label: "PR #42", url: pr.url });
    expect(prLinkToAdd([{ label: "Ticket", url: "u1" }], pr)).toEqual({ label: "PR #42", url: pr.url });
  });
  it("returns null when a link with the same url already exists", () => {
    expect(prLinkToAdd([{ label: "old", url: pr.url }], pr)).toBeNull();
  });
});

describe("branchSpecFrom", () => {
  it("builds a pr spec when prNumber > 0 (pr wins over mode)", () => {
    expect(branchSpecFrom({ prNumber: 42, mode: "existing", branch: "feat", base: "main" }))
      .toEqual({ kind: "pr", number: 42, branch: "feat" });
  });
  it("builds an existing spec when no pr and mode is existing", () => {
    expect(branchSpecFrom({ prNumber: 0, mode: "existing", branch: "feat", base: "main" }))
      .toEqual({ kind: "existing", branch: "feat" });
  });
  it("builds a new spec with base otherwise", () => {
    expect(branchSpecFrom({ prNumber: 0, mode: "new", branch: "feat", base: "develop" }))
      .toEqual({ kind: "new", branch: "feat", base: "develop" });
  });
});

describe("FORM_DEFAULTS", () => {
  it("provides the fresh-form defaults", () => {
    expect(FORM_DEFAULTS).toEqual({
      name: "", repoPath: "", mode: "new",
      branch: "", base: "main", startCmd: "npm run dev", address: "http://localhost:3000",
    });
  });
});

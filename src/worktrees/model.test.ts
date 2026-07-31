// model.test.ts — pure worktree helpers (existing link reducers + source link construction from a deduction).
import { describe, it, expect } from "vitest";
import { makeWorktree, addLink, updateLink, removeLink, sourceLinkFrom, prLinkToAdd, branchSpecFrom, FORM_DEFAULTS, resolveHost } from "./model";
import type { DeducedWorktree } from "./api";
import type { KnownRepo, Worktree } from "../settings/types";

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
  it("labels a GitHub PR 'Github: PR' instead of inheriting the long PR title", () => {
    const url = "https://github.com/elder/cockpit/pull/42";
    expect(sourceLinkFrom({ ...deducedBase, sourceUrl: url, sourceTitle: "fix: some very long pull request title" }))
      .toEqual({ label: "Github: PR", url });
  });
  it("keeps the fetched title for a GitHub issue", () => {
    const url = "https://github.com/elder/cockpit/issues/42";
    expect(sourceLinkFrom({ ...deducedBase, sourceUrl: url, sourceTitle: "Checkout is broken" }))
      .toEqual({ label: "Checkout is broken", url });
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

describe("resolveHost", () => {
  const wt = (startCmd: string, address = ""): Worktree => makeWorktree({
    id: "wt-1", name: "n", repoPath: "/repo", branch: "b", worktreePath: "/wt",
    host: { startCmd, address },
  });
  const repos: KnownRepo[] = [{ path: "/repo", host: { startCmd: "pnpm dev", address: "http://localhost:8181" } }];

  it("uses the worktree's own values when set", () => {
    expect(resolveHost(wt("npm start", "http://localhost:3000"), repos))
      .toEqual({ startCmd: "npm start", address: "http://localhost:3000" });
  });
  it("falls back to the repo default when the worktree's are empty", () => {
    expect(resolveHost(wt("", ""), repos)).toEqual({ startCmd: "pnpm dev", address: "http://localhost:8181" });
  });
  it("falls back per field, so one blank half doesn't drag the other", () => {
    expect(resolveHost(wt("npm start", ""), repos))
      .toEqual({ startCmd: "npm start", address: "http://localhost:8181" });
    expect(resolveHost(wt("", "http://localhost:3000"), repos))
      .toEqual({ startCmd: "pnpm dev", address: "http://localhost:3000" });
  });
  it("falls back when the worktree's value is whitespace only", () => {
    expect(resolveHost(wt("   ", "  "), repos)).toEqual({ startCmd: "pnpm dev", address: "http://localhost:8181" });
  });
  it("trims the resolved values", () => {
    expect(resolveHost(wt(" npm start ", " http://x "), repos))
      .toEqual({ startCmd: "npm start", address: "http://x" });
    expect(resolveHost(wt("", ""), [{ path: "/repo", host: { startCmd: " pnpm dev ", address: " http://y " } }]))
      .toEqual({ startCmd: "pnpm dev", address: "http://y" });
  });
  it("returns empty when neither the worktree nor the repo has values", () => {
    expect(resolveHost(wt("", ""), [{ path: "/repo" }])).toEqual({ startCmd: "", address: "" });
    expect(resolveHost(wt("", ""), [])).toEqual({ startCmd: "", address: "" });
  });
  it("only matches the worktree's own repo", () => {
    expect(resolveHost(wt("", ""), [{ path: "/other", host: { startCmd: "pnpm dev", address: "http://z" } }]))
      .toEqual({ startCmd: "", address: "" });
  });
});

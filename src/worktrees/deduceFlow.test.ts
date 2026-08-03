// deduceFlow.test.ts — the deduce→create sequence: pending placement, the in-place swap across both
// slot surfaces, the context prepend, rollback, and the mid-flight liveness guards. Every dependency is
// injected, so these assert the ORDERING and BRANCHING directly — no store, no module mocks.
import { describe, it, expect, vi } from "vitest";
import type { KnownRepo, Worktree } from "../settings/types";
import type { DeducedWorktree } from "./api";
import { startDeduceFlow, type CreateFn, type DeduceFlowSession, type DeduceFn } from "./deduceFlow";

const deduced: DeducedWorktree = {
  repoPath: "/a", name: "fix login", branch: "fix-login", base: "main",
  startCmd: "npm run dev", address: "http://localhost:3000", reason: "matched repo",
};

// The state the fake session reads and writes. Declared explicitly (not inferred) so tests can
// override any field, and so the alias doesn't reference the function that consumes it.
interface FakeState {
  pending: { id: string; prompt: string; status: string; view: string }[];
  seq: number;
  slots: (string | null)[];
  worktrees: Worktree[];
  armed: string[];
  pin: string | undefined;
  error: { prompt: string; message: string } | null;
  knownRepos: KnownRepo[];
  contexts: Record<string, string> | undefined;
  calls: string[]; // ordered log, so sequence itself is assertable
}

// A fake session holding just enough state for the liveness guards to be meaningful.
function fakeSession(overrides: Partial<FakeState> = {}) {
  const state: FakeState = {
    pending: [], seq: 0, slots: [], worktrees: [], armed: [],
    pin: undefined, error: null, knownRepos: [{ path: "/a" }], contexts: undefined, calls: [],
    ...overrides,
  };
  const session: DeduceFlowSession = {
    isLive: (id) => state.pending.some((p) => p.id === id),
    knownRepos: () => state.knownRepos,
    contexts: () => state.contexts,
    cockpitPin: () => state.pin,
    addPending: (prompt, view) => {
      state.seq += 1;
      const id = `pending-${state.seq}`;
      state.pending.push({ id, prompt, status: "deducing", view });
      state.calls.push(`addPending:${id}`);
      return id;
    },
    setPendingStatus: (id, status) => {
      state.pending = state.pending.map((p) => (p.id === id ? { ...p, status } : p));
      state.calls.push(`status:${status}`);
    },
    dropPending: (id) => {
      state.pending = state.pending.filter((p) => p.id !== id);
      state.calls.push(`dropPending:${id}`);
    },
    placeEntity: (id, view) => { state.slots.push(id); state.calls.push(`place:${id}:${view}`); },
    swapSlotId: (from, to) => {
      state.slots = state.slots.map((s) => (s === from ? to : s));
      state.calls.push(`swap:${from}->${to}`);
    },
    clearSlots: (id) => { state.slots = state.slots.filter((s) => s !== id); state.calls.push(`clear:${id}`); },
    addWorktree: (wt) => { state.worktrees.push(wt); state.calls.push("addWorktree"); },
    armInitialPrompt: (id) => { state.armed.push(id); state.calls.push(`arm:${id}`); },
    setCockpitPin: (id) => { state.pin = id ?? undefined; state.calls.push(`pin:${id}`); },
    setError: (e) => { state.error = e; state.calls.push("setError"); },
  };
  return { session, state };
}
// Typed mocks: the injected deps keep their real signatures, so a drifting port shape fails typecheck.
const deduceOk = (d: DeducedWorktree = deduced) => vi.fn<DeduceFn>().mockResolvedValue(d);
const deduceFails = (msg: string) => vi.fn<DeduceFn>().mockRejectedValue(msg);
const createOk = (path = "/wt/fix-login") => vi.fn<CreateFn>().mockResolvedValue(path);
const okDeps = () => ({ deduce: deduceOk(), create: createOk() });

describe("startDeduceFlow", () => {
  it("places a pending tile synchronously, before awaiting deduce", () => {
    const { session, state } = fakeSession();
    // A deduce that never settles: whatever we observe now happened before the first await.
    void startDeduceFlow(
      { prompt: "fix the login bug", view: "worktrees", source: "manual" },
      { session, deduce: () => new Promise(() => {}), create: vi.fn<CreateFn>() },
    );
    expect(state.pending).toEqual([
      { id: "pending-1", prompt: "fix the login bug", status: "deducing", view: "worktrees" },
    ]);
    expect(state.slots).toEqual(["pending-1"]);
  });

  it("marks the tile creating between deduce and create", async () => {
    const { session, state } = fakeSession();
    const deps = okDeps();
    await startDeduceFlow({ prompt: "p", view: "worktrees", source: "manual" }, { session, ...deps });
    expect(state.calls.indexOf("status:creating")).toBeGreaterThan(state.calls.indexOf("addPending:pending-1"));
    expect(state.calls.indexOf("status:creating")).toBeLessThan(state.calls.indexOf("addWorktree"));
  });

  it("success: swaps the pending id for the real worktree in the same slot", async () => {
    const { session, state } = fakeSession();
    await startDeduceFlow({ prompt: "p", view: "worktrees", source: "manual" }, { session, ...okDeps() });
    expect(state.pending).toEqual([]);
    expect(state.worktrees).toHaveLength(1);
    const wt = state.worktrees[0];
    expect(wt.id).toMatch(/^wt-/);
    expect(wt.worktreePath).toBe("/wt/fix-login");
    expect(state.slots).toEqual([wt.id]); // same slot, swapped in place
    expect(state.error).toBeNull();
  });

  it("commits the model before the slot points at it, and drops the pending tile last", async () => {
    const { session, state } = fakeSession();
    await startDeduceFlow({ prompt: "p", view: "worktrees", source: "manual" }, { session, ...okDeps() });
    const order = state.calls.filter((c) => /^(addWorktree|swap:|dropPending:pending-1$)/.test(c));
    expect(order).toEqual(["addWorktree", `swap:pending-1->${state.worktrees[0].id}`, "dropPending:pending-1"]);
  });

  it("success on the cockpit view: repins the real id", async () => {
    const { session, state } = fakeSession({ pin: "pending-1" });
    await startDeduceFlow({ prompt: "p", view: "cockpit", source: "manual" }, { session, ...okDeps() });
    expect(state.pin).toBe(state.worktrees[0].id);
    expect(state.pending).toEqual([]);
  });

  it("leaves an unrelated cockpit pin alone", async () => {
    const { session, state } = fakeSession({ pin: "wt-other" });
    await startDeduceFlow({ prompt: "p", view: "worktrees", source: "manual" }, { session, ...okDeps() });
    expect(state.pin).toBe("wt-other");
  });

  it("prepends the per-source context to the pane prompt; deduce still gets the bare input", async () => {
    const { session, state } = fakeSession();
    const deps = okDeps();
    await startDeduceFlow(
      { prompt: "review https://github.com/a/b/pull/3", view: "cockpit", source: "pr-review" },
      { session, ...deps },
    );
    expect(state.worktrees[0].prompt).toBe(
      "use the /code-review tool to review this PR\n\nreview https://github.com/a/b/pull/3",
    );
    expect(deps.deduce).toHaveBeenCalledWith("review https://github.com/a/b/pull/3", ["/a"]);
  });

  it("stores the prompt on the model and arms the one-shot claude send", async () => {
    const { session, state } = fakeSession();
    await startDeduceFlow({ prompt: "fix the login bug", view: "worktrees", source: "manual" }, { session, ...okDeps() });
    expect(state.worktrees[0].prompt).toBe("fix the login bug");
    expect(state.armed).toEqual([state.worktrees[0].id]);
  });

  it("a repo's saved host default beats the agent's guess, per field", async () => {
    const { session, state } = fakeSession({ knownRepos: [{ path: "/a", host: { startCmd: "pnpm dev", address: "" } }] });
    await startDeduceFlow({ prompt: "p", view: "worktrees", source: "manual" }, { session, ...okDeps() });
    expect(state.worktrees[0].host).toEqual({ startCmd: "pnpm dev", address: "" });
  });

  it("reads knownRepos live, so a default saved during deduce still applies", async () => {
    const { session, state } = fakeSession();
    let resolveDeduce!: (d: DeducedWorktree) => void;
    const run = startDeduceFlow(
      { prompt: "p", view: "worktrees", source: "manual" },
      {
        session,
        deduce: () => new Promise((res) => { resolveDeduce = res; }),
        create: createOk(),
      },
    );
    // The user saves a host default while the agent is still thinking.
    state.knownRepos = [{ path: "/a", host: { startCmd: "bun dev", address: "http://localhost:5173" } }];
    resolveDeduce(deduced);
    await run;
    expect(state.worktrees[0].host).toEqual({ startCmd: "bun dev", address: "http://localhost:5173" });
  });

  it("attaches a resolved source link to the new worktree", async () => {
    const { session, state } = fakeSession();
    const withSource = { ...deduced, sourceUrl: "https://linear.app/x/issue/ENG-1", sourceTitle: "Fix login" };
    await startDeduceFlow(
      { prompt: "ENG-1", view: "worktrees", source: "manual" },
      { session, deduce: deduceOk(withSource), create: createOk("/wt/x") },
    );
    expect(state.worktrees[0].links).toEqual([{ label: "Fix login", url: "https://linear.app/x/issue/ENG-1" }]);
  });

  it("deduce failure: discards the tile, clears the slot, records the error", async () => {
    const { session, state } = fakeSession();
    await startDeduceFlow(
      { prompt: "ENG-1 fix login", view: "worktrees", source: "manual" },
      { session, deduce: deduceFails("couldn't resolve Linear ticket"), create: vi.fn<CreateFn>() },
    );
    expect(state.pending).toEqual([]);
    expect(state.slots).toEqual([]);
    expect(state.worktrees).toHaveLength(0);
    expect(state.error).toEqual({ prompt: "ENG-1 fix login", message: "couldn't resolve Linear ticket" });
  });

  it("create failure rolls back too, and never adds a model", async () => {
    const { session, state } = fakeSession();
    const create = vi.fn<CreateFn>().mockRejectedValue("fatal: invalid reference");
    await startDeduceFlow({ prompt: "p", view: "worktrees", source: "manual" }, { session, deduce: deduceOk(), create });
    expect(state.worktrees).toHaveLength(0);
    expect(state.pending).toEqual([]);
    expect(state.error?.message).toContain("invalid reference");
  });

  it("failure on the cockpit view: clears the pin it placed", async () => {
    const { session, state } = fakeSession({ pin: "pending-1" });
    await startDeduceFlow(
      { prompt: "p", view: "cockpit", source: "manual" },
      { session, deduce: deduceFails("nope"), create: vi.fn<CreateFn>() },
    );
    expect(state.pin).toBeUndefined();
  });

  it("mid-flight discard before deduce resolves: nothing is created", async () => {
    const { session, state } = fakeSession();
    let resolveDeduce!: (d: DeducedWorktree) => void;
    const create = vi.fn<CreateFn>();
    const run = startDeduceFlow(
      { prompt: "p", view: "worktrees", source: "manual" },
      { session, deduce: () => new Promise((res) => { resolveDeduce = res; }), create },
    );
    // The user repicks the slot away, so the pending entity is gone.
    state.pending = [];
    state.slots = [];
    resolveDeduce(deduced);
    await run;
    expect(create).not.toHaveBeenCalled();
    expect(state.worktrees).toHaveLength(0);
    expect(state.error).toBeNull(); // abandoned quietly — not an error the user should see
  });

  it("mid-flight discard between create and commit: no model, no slot written", async () => {
    const { session, state } = fakeSession();
    let resolveCreate!: (p: string) => void;
    const run = startDeduceFlow(
      { prompt: "p", view: "worktrees", source: "manual" },
      {
        session,
        deduce: deduceOk(),
        create: () => new Promise((res) => { resolveCreate = res; }),
      },
    );
    await Promise.resolve(); // let the chain reach the create await
    state.pending = [];
    state.slots = [];
    resolveCreate("/wt/fix-login");
    await run;
    expect(state.worktrees).toHaveLength(0);
    expect(state.calls).not.toContain("addWorktree");
  });
});

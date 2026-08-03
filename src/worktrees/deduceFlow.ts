// deduceFlow.ts — the deduce→create background chain: place a pending tile, deduce, create the git
// worktree, then swap the real worktree into the same slot (or roll everything back on failure).
// No React and no store import: session state is reached through an injected port, so the SEQUENCE —
// the guards, the ordering, the rollback — is testable without standing up a store.
import type { KnownRepo, Worktree } from "../settings/types";
import type { BranchSpec, DeducedWorktree } from "./api";
import { branchSpecFrom, makeWorktree, sourceLinkFrom } from "./model";
import { effectiveContext, type WorktreeSource } from "./worktreeContext";

type View = "cockpit" | "worktrees" | "calm";

export interface DeduceFlowInput {
  prompt: string;
  view: View;
  source: WorktreeSource;
}

// The session operations this flow needs, as single-step reads and writes. Deliberately granular and
// named for state rather than intent: a coarse `commit(pendingId, worktree)` would move the two-surface
// swap and the rollback into the port's implementation, i.e. back outside this module's test surface.
export interface DeduceFlowSession {
  // reads — called live, not snapshotted at start: `deduce` takes 15-43s, and a repo host default (or a
  // source context) saved during that window must still reach the worktree being created.
  isLive(pendingId: string): boolean;
  knownRepos(): KnownRepo[];
  contexts(): Record<string, string> | undefined;
  cockpitPin(): string | undefined;
  // writes
  addPending(prompt: string, view: View): string; // mints the `pending-<n>` id and returns it
  setPendingStatus(pendingId: string, status: "deducing" | "creating"): void;
  dropPending(pendingId: string): void;
  placeEntity(id: string, view: View): void;
  swapSlotId(from: string, to: string): void;
  clearSlots(id: string): void;
  addWorktree(worktree: Worktree): void;
  armInitialPrompt(worktreeId: string): void;
  setCockpitPin(id: string | null): void;
  setError(error: { prompt: string; message: string }): void;
}

export type DeduceFn = (prompt: string, repoPaths: string[]) => Promise<DeducedWorktree>;
export type CreateFn = (repoPath: string, name: string, spec: BranchSpec) => Promise<string>;

export interface DeduceFlowDeps {
  session: DeduceFlowSession;
  deduce: DeduceFn;
  create: CreateFn;
}

// startDeduceFlow: the whole chain. The pending tile is placed synchronously (before the first await)
// so the modal can close onto a spinner; everything after that runs in the background. Resolves when
// the chain settles either way — it never rejects, because there is no caller left to catch by then.
export async function startDeduceFlow(
  { prompt, view, source }: DeduceFlowInput,
  { session, deduce, create }: DeduceFlowDeps,
): Promise<void> {
  const pendingId = session.addPending(prompt, view);
  session.placeEntity(pendingId, view);

  try {
    const d = await deduce(prompt, session.knownRepos().map((r) => r.path));
    // Guard: the user may have repicked or closed the slot during the deduce. Abandon quietly —
    // nothing has been created yet, so there is nothing to clean up.
    if (!session.isLive(pendingId)) return;
    session.setPendingStatus(pendingId, "creating");

    const worktreePath = await create(d.repoPath, d.name, specFor(d));
    // Second guard, same reason. An orphaned git worktree is accepted here (rare, and cleaning it up
    // would need a teardown the user never asked for) — see the plan's deferred list.
    if (!session.isLive(pendingId)) return;

    const realId = `wt-${Date.now()}`;
    session.addWorktree(makeWorktree({
      id: realId, name: d.name, repoPath: d.repoPath, branch: d.branch,
      worktreePath, host: resolveNewHost(d, session.knownRepos()),
      links: linksFor(d), prompt: panePrompt(prompt, source, session.contexts()),
    }));
    commit(pendingId, realId, session);
  } catch (e) {
    rollback(pendingId, prompt, String(e), session);
  }
}

function specFor(d: DeducedWorktree): BranchSpec {
  return branchSpecFrom({
    prNumber: d.prNumber ?? 0,
    mode: d.existingBranch ? "existing" : "new",
    branch: d.branch,
    base: d.base,
  });
}

// A repo's saved host default wins over the agent's guess (the agent guesses from the repo digest;
// a saved default is the user having already told us the answer).
function resolveNewHost(d: DeducedWorktree, knownRepos: KnownRepo[]) {
  const saved = knownRepos.find((r) => r.path === d.repoPath)?.host;
  return { startCmd: saved?.startCmd ?? d.startCmd, address: saved?.address ?? d.address };
}

function linksFor(d: DeducedWorktree) {
  const link = sourceLinkFrom(d);
  return link ? [link] : [];
}

// The prompt the CLAUDE pane receives: the per-source context prepended to the user's input. The
// deduce call above deliberately got the bare input — the context is guidance for step 2 only.
function panePrompt(prompt: string, source: WorktreeSource, contexts: Record<string, string> | undefined): string {
  const ctx = effectiveContext(source, contexts);
  return ctx ? `${ctx}\n\n${prompt}` : prompt;
}

// Success: swap the pending id for the real one across BOTH slot surfaces (the shared columns and the
// Cockpit pin), arm the claude pane's one-shot prompt send, then drop the pending entity. No awaits
// in here, so the intermediate state is never observable.
function commit(pendingId: string, worktreeId: string, session: DeduceFlowSession): void {
  session.swapSlotId(pendingId, worktreeId);
  session.armInitialPrompt(worktreeId);
  if (session.cockpitPin() === pendingId) session.setCockpitPin(worktreeId);
  session.dropPending(pendingId);
}

// Failure: discard the tile everywhere it shows, then record the error so the modal reopens prefilled.
function rollback(pendingId: string, prompt: string, message: string, session: DeduceFlowSession): void {
  session.dropPending(pendingId);
  session.clearSlots(pendingId);
  if (session.cockpitPin() === pendingId) session.setCockpitPin(null);
  session.setError({ prompt, message });
}

// attentionNotifier.ts — turns the session-only attention map into a desktop notification.
// The map itself stays a pure store flag (workspace.ts); everything OS-facing lives here.
import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useSettings } from "../settings/store";
import type { ScratchTerminal } from "../views/slots";
import type { Worktree } from "../settings/types";

// Which panes were marked since the last snapshot. Presence, not truth, is the signal: a pane that is
// already marked bells repeatedly while Claude waits, and only the first bell deserves a notification.
export function newlyMarked(prev: Record<string, true>, next: Record<string, true>): string[] {
  return Object.keys(next).filter((ptyId) => !prev[ptyId]);
}

// A ptyId is "{entityId}:{role}" (ptyId.ts). Notifications name the thing the user recognises — the
// worktree or scratch title — and mention the role only when it is not the pane they expect Claude in.
export function attentionLabel(
  ptyId: string,
  worktrees: readonly Worktree[],
  scratch: readonly ScratchTerminal[],
): string {
  const sep = ptyId.indexOf(":");
  const entityId = ptyId.slice(0, sep);
  const role = ptyId.slice(sep + 1);
  const name = worktrees.find((w) => w.id === entityId)?.name
    ?? scratch.find((s) => s.id === entityId)?.title;
  if (!name) return ptyId; // the worktree was removed between the bell and this lookup
  return role === "claude" || role === "shell" ? name : `${name} · ${role}`;
}

// The three OS-facing calls, injected so the decision above them stays testable.
export interface AttentionPorts {
  isFocused: () => Promise<boolean>;
  notify: (title: string, body: string) => Promise<void>;
  bounce: () => Promise<void>;
}

const NOTIFICATION_TITLE = "Check me out"; // matches the in-app badge, so the two read as one signal

// Announce panes that just started waiting. Silent while cockpit is focused: the pane is already
// glowing on screen, and a banner for something you are looking at is noise.
export async function notifyAttention(
  labels: readonly string[],
  ports: AttentionPorts,
  enabled: boolean,
): Promise<void> {
  if (!enabled || labels.length === 0) return;
  if (await ports.isFocused()) return;
  // Best-effort throughout: a refused notification must not cost the user the Dock bounce, nor one
  // pane's banner cost another's.
  await ports.bounce().catch(() => {});
  for (const label of labels) {
    await ports.notify(NOTIFICATION_TITLE, label).catch(() => {});
  }
}

// The real OS calls. Verified by hand against the packaged .app rather than by unit test: macOS only
// delivers notifications to a real bundle, so there is nothing meaningful to assert in vitest.
const livePorts: AttentionPorts = {
  isFocused: () => getCurrentWindow().isFocused(),
  notify: async (title, body) => {
    if (!(await isPermissionGranted())) return;
    sendNotification({ title, body });
  },
  bounce: () => getCurrentWindow().requestUserAttention(UserAttentionType.Critical),
};

// Watch the attention map and announce each fresh mark. A subscriber rather than a call inside
// markAttention: the store slice stays pure and OS-free, and the bell path keeps one job.
export function startAttentionNotifier(ports: AttentionPorts = livePorts): () => void {
  return useSettings.subscribe((st, prev) => {
    if (st.attention === prev.attention) return; // every other store write lands here too
    const labels = newlyMarked(prev.attention, st.attention)
      .map((ptyId) => attentionLabel(ptyId, st.cockpit.worktrees, st.scratchTerminals));
    void notifyAttention(labels, ports, st.cockpit.preferences.notifyOnAttention ?? true);
  });
}

// Ask at launch, so the OS authorisation prompt lands on an empty screen rather than on the first bell.
//
// It cannot fully prevent the loss: on a first run macOS reports permission as ALREADY granted, then
// consumes the first real delivery to raise its prompt — so exactly one notification, once per install,
// never appears. Verified by hand against the packaged .app. The in-app badge is unaffected.
export async function primeNotifications(): Promise<void> {
  try {
    await requestPermission();
  } catch {
    /* no notification service (or the user has denied it) — the badge and glow still do their job */
  }
}

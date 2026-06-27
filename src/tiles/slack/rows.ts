// rows.ts — pure ordering helpers for the Slack tile.
import type { SlackConversation } from "./types";

// Newest first by Slack ts. Copy first so React state isn't mutated in place.
export function sortByRecency(convs: SlackConversation[]): SlackConversation[] {
  return [...convs].sort((a, b) => b.latestTs.localeCompare(a.latestTs));
}

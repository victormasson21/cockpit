// watchFilter.ts — pure case-insensitive filter for the watched-conversations picker search box.
import type { ConversationMeta } from "./types";

// Keep conversations (channels + DMs, all opt-in) whose name matches the query.
export function filterConversations(convs: ConversationMeta[], query: string): ConversationMeta[] {
  const q = query.trim().toLowerCase();
  return convs.filter((c) => c.name.toLowerCase().includes(q));
}

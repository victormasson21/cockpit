// types.ts — TS shapes mirroring the Rust slack provider payloads.

export interface SlackConversation {
  id: string;
  kind: "channel" | "im" | "mpim";
  name: string;
  avatarUrl?: string;
  unreadCount: number;
  latestText: string;
  latestTs: string;
}

export interface SlackSnapshot {
  connected: boolean;
  error?: string;
  conversations: SlackConversation[];
}

export interface SlackStatus {
  connected: boolean;
  userName?: string;
  hasCredentials: boolean;
}

export interface ConversationMeta {
  id: string;
  name: string;
  kind: "channel" | "im" | "mpim";
}

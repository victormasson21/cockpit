// api.ts — typed wrappers over the Slack provider IPC commands.

import { invoke } from "@tauri-apps/api/core";
import type { SlackSnapshot, SlackStatus, ConversationMeta } from "./types";

export const slackStatus = () => invoke<SlackStatus>("slack_status");

export const slackSnapshot = () => invoke<SlackSnapshot>("slack_snapshot");

export const slackConnect = () => invoke<string>("slack_connect"); // returns authorize URL

export const slackDisconnect = () => invoke<void>("slack_disconnect");

export const slackRefresh = () => invoke<void>("slack_refresh");

export const slackListConversations = () =>
  invoke<ConversationMeta[]>("slack_list_conversations");

export const slackSetWatched = (ids: string[]) =>
  invoke<void>("slack_set_watched", { ids });

export const slackSetCredentials = (clientId: string, clientSecret?: string) =>
  invoke<void>("slack_set_credentials", {
    clientId,
    clientSecret: clientSecret ?? null,
  });

export const slackInit = (
  clientId: string | undefined,
  watchedChannelIds: string[]
) =>
  invoke<void>("slack_init", {
    clientId: clientId ?? null,
    watchedChannelIds,
  });

export const slackPermalink = (channelId: string, ts: string) =>
  invoke<string>("slack_permalink", { channelId, ts });

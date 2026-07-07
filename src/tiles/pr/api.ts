// api.ts — typed wrapper over the pr_reviews_fetch IPC command.
import { invoke } from "@tauri-apps/api/core";
import type { PrReviewItem } from "../../settings/types";

export interface PrFetchResult {
  items: PrReviewItem[];
  newestTs?: string;
}

export const prReviewsFetch = (channelId: string, oldest?: string) =>
  invoke<PrFetchResult>("pr_reviews_fetch", { channelId, oldest: oldest ?? null });

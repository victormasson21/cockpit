// PrReviewsTile.tsx — manual-refresh list of PR review requests from the configured Slack channel;
// Remove drops an item, Review fires the existing background deduce→create worktree flow.
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Tile } from "../Tile";
import { RestartIcon } from "../../views/icons";
import { useSettings } from "../../settings/store";
import { prReviewsFetch } from "./api";
import { relativeTime } from "../slack/time";
import type { PrReviewItem } from "../../settings/types";
import "../slack/slack.css"; // reuse the gear/cta/empty styles
import "./pr.css";

export function PrReviewsTile({ onOpenSettings }: { onOpenSettings: () => void }) {
  const pr = useSettings((s) => s.cockpit.integrations?.prReviews);
  const applyPrFetch = useSettings((s) => s.applyPrFetch);
  const removePrItem = useSettings((s) => s.removePrItem);
  const startDeduceWorktree = useSettings((s) => s.startDeduceWorktree);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null); // session-only
  const [error, setError] = useState<string | null>(null);

  // Manual refresh: fetch messages since the cursor; the store merge dedupes and advances the cursor.
  const refresh = async () => {
    if (!pr?.channelId || refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await prReviewsFetch(pr.channelId, pr.lastSeenTs);
      applyPrFetch(res.items, res.newestTs);
      setRefreshedAt(Date.now());
    } catch (e) {
      setError(String(e));
    }
    setRefreshing(false);
  };

  // Review: hand the PR to the existing deduce flow (its GitHub path checks the PR out deterministically).
  const review = (item: PrReviewItem) => startDeduceWorktree(`${item.title} ${item.url}`, "cockpit");

  const items = pr?.items ?? [];
  // relativeTime says "now" for <60s — read as "just now" here to avoid "Refreshed now ago".
  const rel = refreshedAt ? relativeTime(refreshedAt / 1000, Date.now()) : null;
  const actions = (
    <>
      {rel && <span className="pr-tile__refreshed">{rel === "now" ? "Refreshed just now" : `Refreshed ${rel} ago`}</span>}
      <button
        className={`slack-tile__gear${refreshing ? " slack-tile__gear--spin" : ""}`}
        aria-label="refresh pr reviews"
        disabled={!pr?.channelId || refreshing}
        onClick={refresh}
      >
        <RestartIcon />
      </button>
    </>
  );

  return (
    <Tile title="PR REVIEWS" actions={actions}>
      {!pr?.channelId ? (
        <button className="slack-tile__cta" onClick={onOpenSettings}>Pick a PR channel in Settings</button>
      ) : (
        <>
          {error && <div className="pr-tile__error">⚠ {error}</div>}
          {items.length === 0 && !error ? (
            <div className="slack-tile__empty">No PR requests</div>
          ) : (
            <ul className="pr-tile__list">
              {items.map((i) => (
                <li key={i.id} className="pr-tile__row">
                  <div className="pr-tile__meta">
                    <span className="pr-tile__repo">{i.repo}</span>
                    <span className="pr-tile__num">#{i.number}</span>
                    <span className="pr-tile__author">· {i.author}</span>
                  </div>
                  {/* Title opens the PR in the browser; mode badge shows the Ship/Show/Ask marker. */}
                  <div className="pr-tile__title" onClick={() => openUrl(i.url)}>
                    {i.mode && <span className="pr-tile__mode">{i.mode}</span>}
                    {i.title}
                  </div>
                  <div className="pr-tile__actions">
                    <button className="pr-tile__remove" onClick={() => removePrItem(i.id)}>Remove</button>
                    <button className="pr-tile__review" onClick={() => review(i)}>+ Review</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Tile>
  );
}

// PrReviewsTile.tsx — manual-refresh list of PR review requests from the configured Slack channel;
// Remove drops an item, Review fires the existing background deduce→create worktree flow.
import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Tile } from "../Tile";
import { RestartIcon } from "../../views/icons";
import { useSettings } from "../../settings/store";
import { CreateWorktreeButton } from "../../views/CreateWorktreeButton";
import { prReviewsFetch } from "./api";
import { relativeTime } from "../slack/time";
import "../slack/slack.css"; // reuse the gear/cta/empty styles
import "./pr.css";

export function PrReviewsTile({ onOpenSettings }: { onOpenSettings: () => void }) {
  const pr = useSettings((s) => s.cockpit.integrations?.prReviews);
  const applyPrFetch = useSettings((s) => s.applyPrFetch);
  const removePrItem = useSettings((s) => s.removePrItem);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null); // session-only
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false); // overlap guard for interval/focus vs a slow fetch (state is async)

  // Fetch messages since the cursor; the store merge dedupes and advances the cursor.
  // silent=true (auto: interval + focus) skips the spinner and swallows errors; the
  // manual button (silent=false) shows both. New items + the timestamp update either way.
  const doRefresh = async ({ silent }: { silent: boolean }) => {
    if (!pr?.channelId || inFlight.current) return;
    const channelId = pr.channelId; // captured: guard against the user switching channels mid-fetch
    inFlight.current = true;
    if (!silent) {
      setRefreshing(true);
      setError(null);
    }
    try {
      const res = await prReviewsFetch(channelId, pr.lastSeenTs);
      // Only apply if the picked channel is still the one we fetched (else drop the stale result).
      if (useSettings.getState().cockpit.integrations?.prReviews?.channelId === channelId) {
        applyPrFetch(res.items, res.newestTs);
        setRefreshedAt(Date.now());
      }
    } catch (e) {
      if (!silent) setError(String(e));
      else console.warn("PR reviews auto-refresh failed:", e);
    }
    inFlight.current = false;
    if (!silent) setRefreshing(false);
  };

  // Auto-refresh: every 2 min while open + on window focus (mirrors the Slack tile), both silent.
  useEffect(() => {
    const auto = () => doRefresh({ silent: true });
    const timer = setInterval(auto, 120_000);
    window.addEventListener("focus", auto);
    return () => { clearInterval(timer); window.removeEventListener("focus", auto); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr?.channelId, pr?.lastSeenTs]);

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
        onClick={() => doRefresh({ silent: false })}
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
                    <CreateWorktreeButton source="pr-review" view="cockpit" getInput={() => `${i.title} ${i.url}`} title="Create worktree to review this PR" />
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

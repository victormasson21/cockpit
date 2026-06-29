// SlackTile.tsx — read-only Slack unread panel: first paint from slack_snapshot, live updates via slack://unread.
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Tile } from "../Tile";
import { GearIcon } from "../../views/icons";
import { slackSnapshot, slackRefresh } from "./api";
import type { SlackSnapshot } from "./types";
import { relativeTime } from "./time";
import { sortByRecency } from "./rows";
import "./slack.css";

export function SlackTile({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [snap, setSnap] = useState<SlackSnapshot>({ connected: false, conversations: [] });

  useEffect(() => {
    let un: (() => void) | undefined;
    slackSnapshot().then(setSnap).catch(() => {});
    listen<SlackSnapshot>("slack://unread", (e) => setSnap(e.payload)).then((u) => (un = u)).catch(() => {});
    // Refresh when the window regains focus so the tile feels live between polls.
    const onFocus = () => slackRefresh().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => { un?.(); window.removeEventListener("focus", onFocus); };
  }, []);

  const rows = sortByRecency(snap.conversations);
  const now = Date.now();
  const gear = <button className="slack-tile__gear" aria-label="slack settings" onClick={onOpenSettings}><GearIcon /></button>;

  return (
    <Tile title="SLACK" actions={gear}>
      {!snap.connected ? (
        <button className="slack-tile__cta" onClick={onOpenSettings}>Connect Slack in Settings</button>
      ) : rows.length === 0 ? (
        <div className="slack-tile__empty">{snap.error ? `⚠ ${snap.error}` : "All caught up"}</div>
      ) : (
        <ul className="slack-tile__list">
          {rows.map((c) => (
            <li key={c.id} className="slack-tile__row" onClick={() => openUrl(`slack://channel?id=${c.id}`)}>
              <span className="slack-tile__icon">{c.kind === "channel" ? "#" : "@"}</span>
              <span className="slack-tile__body">
                <span className="slack-tile__name">{c.name}</span>
                <span className="slack-tile__preview">{c.latestText}</span>
              </span>
              <span className="slack-tile__meta">
                <span className="slack-tile__time">{relativeTime(Number(c.latestTs), now)}</span>
                <span className="slack-tile__badge">{c.unreadCount}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

// SlackConnections.tsx — Settings section: enter Slack app credentials, connect/disconnect, pick watched channels.
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettings } from "../../settings/store";
import { slackStatus, slackConnect, slackDisconnect, slackSetCredentials, slackListConversations, slackSetWatched } from "./api";
import type { SlackStatus, ConversationMeta } from "./types";
import { filterConversations } from "./watchFilter";
import "./SlackConnections.css";

export function SlackConnections() {
  const { cockpit, setSlackClientId, setSlackWatched } = useSettings();
  const slack = cockpit.integrations?.slack;
  const [status, setStatus] = useState<SlackStatus>({ connected: false, hasCredentials: false });
  const [clientId, setClientId] = useState(slack?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [convs, setConvs] = useState<ConversationMeta[]>([]);
  const [watchFilter, setWatchFilter] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    slackStatus().then(setStatus).catch(() => {});
    // Surface the OAuth exchange result: a failed token exchange arrives here with an `error`.
    const p = listen<{ connected: boolean; error?: string }>("slack://connected", (e) => {
      setConnectError(e.payload.connected ? null : (e.payload.error ?? "connection failed"));
      slackStatus().then(setStatus).catch(() => {});
    });
    return () => { p.then((u) => u()); };
  }, []);

  // Load the conversation list (channels + DMs) for the picker once connected.
  useEffect(() => {
    if (status.connected) slackListConversations().then(setConvs).catch(() => {});
  }, [status.connected]);

  const saveCreds = async () => {
    await slackSetCredentials(clientId.trim(), clientSecret.trim() || undefined);
    setSlackClientId(clientId.trim());
    setClientSecret("");
    setStatus(await slackStatus());
  };
  const connect = async () => { setConnectError(null); const url = await slackConnect(); await openUrl(url); };
  const disconnect = async () => { await slackDisconnect(); setStatus(await slackStatus()); };

  const toggleWatch = async (id: string) => {
    const current = slack?.watchedChannelIds ?? [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setSlackWatched(next);
    await slackSetWatched(next);
  };

  return (
    <div className="slack-connections">
      <strong>Connections — Slack</strong>
      <div className="slack-connections__status">{status.connected ? "Connected" : "Not connected"}</div>
      {connectError && <div className="slack-connections__error">Connect failed: {connectError}</div>}
      <input placeholder="Slack app client id" value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <input placeholder="Slack app client secret (stored in Keychain)" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
      <div className="slack-connections__actions">
        <button className="slack-connections__primary" onClick={saveCreds} disabled={!clientId.trim()}>Save credentials</button>
        {status.connected
          ? <button onClick={disconnect}>Disconnect</button>
          : <button className="slack-connections__primary" onClick={connect} disabled={!status.hasCredentials}>Connect Slack</button>}
      </div>
      {status.connected && (
        <div className="slack-connections__watched">
          <span className="slack-connections__watched-label">Watched conversations</span>
          <input
            className="slack-connections__watch-search"
            placeholder="Search channels & DMs…"
            value={watchFilter}
            onChange={(e) => setWatchFilter(e.target.value)}
          />
          {filterConversations(convs, watchFilter).map((c) => (
            <label key={c.id} className="slack-connections__watch-row">
              <input type="checkbox" checked={(slack?.watchedChannelIds ?? []).includes(c.id)} onChange={() => toggleWatch(c.id)} />
              {c.kind === "channel" ? "#" : "@"} {c.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

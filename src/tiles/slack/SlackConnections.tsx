// SlackConnections.tsx — Settings section: enter Slack app credentials, connect/disconnect, pick watched channels.
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettings } from "../../settings/store";
import { slackStatus, slackConnect, slackDisconnect, slackSetCredentials, slackListConversations, slackSetWatched } from "./api";
import type { SlackStatus, ConversationMeta } from "./types";

export function SlackConnections() {
  const { cockpit, setSlackClientId, setSlackWatched } = useSettings();
  const slack = cockpit.integrations?.slack;
  const [status, setStatus] = useState<SlackStatus>({ connected: false, hasCredentials: false });
  const [clientId, setClientId] = useState(slack?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [convs, setConvs] = useState<ConversationMeta[]>([]);

  useEffect(() => {
    slackStatus().then(setStatus).catch(() => {});
    const p = listen<SlackStatus>("slack://connected", () => slackStatus().then(setStatus).catch(() => {}));
    return () => { p.then((u) => u()); };
  }, []);

  // Load the conversation list for the picker once connected.
  useEffect(() => {
    if (status.connected) slackListConversations().then(setConvs).catch(() => {});
  }, [status.connected]);

  const saveCreds = async () => {
    await slackSetCredentials(clientId.trim(), clientSecret.trim() || undefined);
    setSlackClientId(clientId.trim());
    setClientSecret("");
    setStatus(await slackStatus());
  };
  const connect = async () => { const url = await slackConnect(); await openUrl(url); };
  const disconnect = async () => { await slackDisconnect(); setStatus(await slackStatus()); };

  const toggleWatch = async (id: string) => {
    const current = slack?.watchedChannelIds ?? [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setSlackWatched(next);
    await slackSetWatched(next);
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <strong style={{ fontSize: 13 }}>Connections — Slack</strong>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{status.connected ? "Connected" : "Not connected"}</div>
      <input placeholder="Slack app client id" value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <input placeholder="Slack app client secret (stored in Keychain)" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={saveCreds} disabled={!clientId.trim()}>Save credentials</button>
        {status.connected
          ? <button onClick={disconnect}>Disconnect</button>
          : <button onClick={connect} disabled={!status.hasCredentials}>Connect Slack</button>}
      </div>
      {status.connected && (
        <div style={{ display: "grid", gap: 4, maxHeight: 200, overflow: "auto", borderTop: "1px solid var(--border-subtle)", paddingTop: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Watched channels</span>
          {convs.map((c) => (
            <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
              <input type="checkbox" checked={(slack?.watchedChannelIds ?? []).includes(c.id)} onChange={() => toggleWatch(c.id)} />
              {c.kind === "channel" ? "#" : "@"} {c.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

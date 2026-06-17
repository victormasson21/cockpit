// LinksList.tsx — editable list of a worktree's useful links; clicking opens in the default browser.
import { openUrl } from "@tauri-apps/plugin-opener";
import type { WorktreeLink } from "../../settings/types";
import { useSettings } from "../../settings/store";
import { addLink, updateLink, removeLink } from "../../worktrees/model";

export function LinksList({ worktreeId, links }: { worktreeId: string; links: WorktreeLink[] }) {
  const { updateWorktree } = useSettings();
  const commit = (next: WorktreeLink[]) => updateWorktree(worktreeId, { links: next });
  return (
    <div style={{ padding: 6, fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <strong>Links</strong>
        <button style={{ marginLeft: "auto" }} onClick={() => commit(addLink(links, { label: "New", url: "" }))}>+ link</button>
      </div>
      {links.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 4, marginTop: 4 }}>
          <input value={l.label} placeholder="label" style={{ width: 90 }}
            onChange={(e) => commit(updateLink(links, i, { label: e.target.value }))} />
          <input value={l.url} placeholder="https://…" style={{ flex: 1 }}
            onChange={(e) => commit(updateLink(links, i, { url: e.target.value }))} />
          <button disabled={!l.url} onClick={() => openUrl(l.url)}>open</button>
          <button onClick={() => commit(removeLink(links, i))}>✕</button>
        </div>
      ))}
    </div>
  );
}

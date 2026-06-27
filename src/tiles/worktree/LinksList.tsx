// LinksList.tsx — a worktree's user links rendered as chips inside the top row; click opens, inline edit/remove, + link.
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { WorktreeLink } from "../../settings/types";
import { useSettings } from "../../settings/store";
import { addLink, updateLink, removeLink } from "../../worktrees/model";

// Returns chip elements (a fragment) so links sit in the same flex row as the derived chips.
export function LinksList({ worktreeId, links }: { worktreeId: string; links: WorktreeLink[] }) {
  const { updateWorktree } = useSettings();
  const commit = (next: WorktreeLink[]) => updateWorktree(worktreeId, { links: next });
  // A link is being edited if explicitly opened OR still blank (freshly added via + link).
  const [editing, setEditing] = useState<Set<number>>(new Set());
  const setEdit = (i: number, on: boolean) =>
    setEditing((s) => { const n = new Set(s); on ? n.add(i) : n.delete(i); return n; });

  return (
    <>
      {links.map((l, i) =>
        editing.has(i) || !l.url ? (
          <span key={i} className="wt-chip wt-chip--link wt-linkchip__edit">
            <input value={l.label} placeholder="label" autoFocus
              onChange={(e) => commit(updateLink(links, i, { label: e.target.value }))} />
            <input className="wt-linkchip__url" value={l.url} placeholder="https://…"
              onChange={(e) => commit(updateLink(links, i, { url: e.target.value }))} />
            <button className="wt-linkchip__act" title="done" disabled={!l.url} onClick={() => setEdit(i, false)}>✓</button>
            <button className="wt-linkchip__act" title="remove" onClick={() => commit(removeLink(links, i))}>✕</button>
          </span>
        ) : (
          <span key={i} className="wt-chip wt-chip--link wt-linkchip">
            <button className="wt-linkchip__open" onClick={() => openUrl(l.url)}>{l.label || l.url}</button>
            <button className="wt-linkchip__act" title="edit" onClick={() => setEdit(i, true)}>✎</button>
            <button className="wt-linkchip__act" title="remove" onClick={() => commit(removeLink(links, i))}>✕</button>
          </span>
        ),
      )}
      <button className="wt-chip wt-chip--add" onClick={() => commit(addLink(links, { label: "", url: "" }))}>+ link</button>
    </>
  );
}

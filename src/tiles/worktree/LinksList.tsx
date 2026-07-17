// LinksList.tsx — a worktree's user links rendered as chips inside the top row; click opens, inline edit/remove, + link.
import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { WorktreeLink } from "../../settings/types";
import { useSettings } from "../../settings/store";
import { addLink, updateLink, removeLink, prLinkToAdd } from "../../worktrees/model";
import { worktreePr } from "../../worktrees/api";

// Returns chip elements (a fragment) so links sit in the same flex row as the derived chips.
// worktreePath backs the "+ PR" button, which asks gh for the branch's PR and links it.
export function LinksList({ worktreeId, worktreePath, links }: { worktreeId: string; worktreePath: string; links: WorktreeLink[] }) {
  const { updateWorktree } = useSettings();
  const commit = (next: WorktreeLink[]) => updateWorktree(worktreeId, { links: next });
  // A link is being edited if explicitly opened OR still blank (freshly added via + link).
  const [editing, setEditing] = useState<Set<number>>(new Set());
  const setEdit = (i: number, on: boolean) =>
    setEditing((s) => { const n = new Set(s); on ? n.add(i) : n.delete(i); return n; });

  // + PR: query gh for the branch's PR; add it if found & not already linked, else show a transient note.
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const detectPr = async () => {
    setBusy(true);
    setNote(null);
    try {
      const pr = await worktreePr(worktreePath);
      if (!pr) { setNote("no PR found"); return; }
      const link = prLinkToAdd(links, pr);
      if (!link) { setNote("already linked"); return; }
      commit(addLink(links, link));
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  };

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
      <button className="wt-chip wt-chip--add" disabled={busy} title="detect the branch's PR via gh and link it" onClick={detectPr}>
        {busy ? "…" : "+ PR"}
      </button>
      {note && <span className="wt-chip wt-chip--note">{note}</span>}
    </>
  );
}

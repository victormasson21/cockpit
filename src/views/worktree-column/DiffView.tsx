// DiffView.tsx — the Cockpit Diff tab body: branch-vs-base stat list with lazily-expanded, colorized hunks.
import { useState, useEffect, useCallback } from "react";
import type { Worktree } from "../../settings/types";
import { worktreeDiff, worktreeFileDiff, type DiffFile } from "../../worktrees/api";
import { parseHunks } from "./diffLines";
import { RestartIcon } from "../icons";

// Two-digit HH:MM:SS so the "as of" label makes the snapshot's staleness obvious.
const clock = (d: Date) => d.toTimeString().slice(0, 8);

export function DiffView({ worktree }: { worktree: Worktree }) {
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [base, setBase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null); // path of the open file, if any

  // Fetch the stat summary; base="" lets the backend derive the repo default branch.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await worktreeDiff(worktree.worktreePath, worktree.repoPath, "");
      setFiles(res.files);
      setBase(res.base);
      setExpanded(null);
      setAsOf(new Date());
    } catch (e) {
      setError(String(e));
      setFiles(null);
    } finally {
      setLoading(false);
    }
  }, [worktree.worktreePath, worktree.repoPath]);

  // Recompute on tab-open / worktree change; snapshot only (no polling — see the design's freshness note).
  useEffect(() => { load(); }, [load]);

  return (
    <div className="wt-diff">
      <div className="wt-diff__bar">
        <span className="wt-diff__base">{base ? `vs ${base}` : "diff"}</span>
        {asOf && <span className="wt-diff__asof">as of {clock(asOf)}</span>}
        <button
          className={`icon-btn wt-diff__refresh${loading ? " wt-diff__refresh--spin" : ""}`}
          aria-label="refresh diff" title="refresh" disabled={loading} onClick={load}
        ><RestartIcon /></button>
      </div>
      {error ? (
        <div className="wt-diff__msg">{error}</div>
      ) : files && files.length === 0 ? (
        <div className="wt-diff__msg">No changes vs {base}</div>
      ) : files ? (
        <div className="wt-diff__files">
          {files.map((f) => (
            <FileRow
              key={f.path} file={f} worktree={worktree} base={base}
              open={expanded === f.path}
              onToggle={() => setExpanded((p) => (p === f.path ? null : f.path))}
            />
          ))}
        </div>
      ) : (
        <div className="wt-diff__msg">Loading…</div>
      )}
    </div>
  );
}

// One stat row (path + +N/-N) that lazily loads and expands its file's colorized hunks on click.
function FileRow({ file, worktree, base, open, onToggle }: {
  file: DiffFile; worktree: Worktree; base: string; open: boolean; onToggle: () => void;
}) {
  const [patch, setPatch] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Fetch the raw patch the first time this row is opened; keep it cached after.
  useEffect(() => {
    if (!open || patch !== null || err) return;
    worktreeFileDiff(worktree.worktreePath, worktree.repoPath, base, file.path)
      .then(setPatch)
      .catch((e) => setErr(String(e)));
  }, [open, patch, err, worktree.worktreePath, worktree.repoPath, base, file.path]);

  return (
    <div className="wt-diff__file">
      <button className="wt-diff__file-row" onClick={onToggle} aria-expanded={open}>
        <span className="wt-diff__path">{file.path}</span>
        {file.binary ? (
          <span className="wt-diff__bin">binary</span>
        ) : (
          <span className="wt-diff__stat">
            <span className="wt-diff__add">+{file.added}</span>{" "}
            <span className="wt-diff__del">-{file.removed}</span>
          </span>
        )}
      </button>
      {open && (
        <div className="wt-diff__hunks">
          {err ? (
            <div className="wt-diff__msg">{err}</div>
          ) : patch === null ? (
            <div className="wt-diff__msg">Loading…</div>
          ) : (
            parseHunks(patch).map((l, i) => (
              <div key={i} className={`wt-diff__line wt-diff__line--${l.kind}`}>{l.text || " "}</div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

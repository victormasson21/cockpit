// diffLines.ts — turn a raw unified patch into typed lines for colored rendering (pure, tested).

export type DiffLineKind = "add" | "del" | "ctx" | "hunk";
export interface DiffLine { kind: DiffLineKind; text: string }

// Classify each patch line for coloring; drop the file-header noise (diff --git / index / ---/+++)
// so only the hunk header (@@) and its +/-/context body lines remain. `--- ` / `+++ ` are dropped
// before the +/- check so file-header markers aren't mistaken for content additions/removals.
export function parseHunks(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const line of patch.split("\n")) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename from") ||
      line.startsWith("rename to")
    ) {
      continue;
    }
    if (line.startsWith("@@")) out.push({ kind: "hunk", text: line });
    else if (line.startsWith("+")) out.push({ kind: "add", text: line });
    else if (line.startsWith("-")) out.push({ kind: "del", text: line });
    else out.push({ kind: "ctx", text: line });
  }
  // Trailing empty line from a final newline adds a bare ctx line — harmless, but trim it.
  if (out.length && out[out.length - 1].kind === "ctx" && out[out.length - 1].text === "") out.pop();
  return out;
}

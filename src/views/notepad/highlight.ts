// highlight.ts — colour-only tokenizer for the notepad's code overlay: comments, strings, numbers, one shared
// keyword list, punctuation. Language-agnostic on purpose; anything uncertain stays plain `text`, so the
// failure mode is "uncoloured", never "wrongly coloured".
export type TokenKind = "comment" | "string" | "number" | "keyword" | "punct" | "text";
export interface Token { kind: TokenKind; text: string }
export interface Region { start: number; end: number }

export const MAX_HIGHLIGHT_CHARS = 200_000; // above this the overlay renders plain text
export const CODE_SCORE_THRESHOLD = 0.4;    // share of non-blank lines that must look like code

// Control-flow and declaration words shared across TypeScript, Rust, Python, Bash, Kotlin and Go.
const KEYWORDS = new Set([
  "if", "else", "elif", "for", "while", "do", "return", "break", "continue", "switch", "case", "default", "match",
  "fn", "function", "def", "let", "const", "var", "val", "class", "struct", "enum", "impl", "trait", "interface", "type",
  "import", "from", "export", "use", "pub", "mod", "package", "as", "in", "of", "new", "this", "self", "super",
  "async", "await", "try", "catch", "finally", "throw", "raise", "except", "with", "yield",
  "true", "false", "null", "nil", "None", "undefined", "and", "or", "not", "is", "then", "fi", "done", "esac", "local",
]);

// One pass, first alternative wins. `//` not after `:` or a word char (URLs); `#` not before a word char or
// `[` (#fff, #include, #[derive]); strings must close on their line (backticks may span lines).
const TOKEN_RE =
  /(?<comment>(?<![:\w])\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?<!\w)#(?![\w[])[^\n]*)|(?<string>"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(?<number>\b(?:0x[0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b)|(?<word>[A-Za-z_$][\w$]*)|(?<punct>[{}()[\];,.:=<>+\-*/%!&|^~?@])|(?<text>\s+|.)/gs;

function kindOf(groups: Record<string, string | undefined>): TokenKind {
  if (groups.comment !== undefined) return "comment";
  if (groups.string !== undefined) return "string";
  if (groups.number !== undefined) return "number";
  if (groups.word !== undefined) return KEYWORDS.has(groups.word) ? "keyword" : "text";
  if (groups.punct !== undefined) return "punct";
  return "text";
}

// Adjacent plain runs merge into one token so the overlay stays a short list of spans.
export function tokenize(code: string): Token[] {
  const out: Token[] = [];
  for (const m of code.matchAll(TOKEN_RE)) {
    const kind = kindOf(m.groups ?? {});
    const last = out[out.length - 1];
    if (kind === "text" && last?.kind === "text") last.text += m[0];
    else out.push({ kind, text: m[0] });
  }
  return out;
}

// A line "looks like code" when it ends in a statement/block char, starts with a declaration keyword or a
// shell prompt, or carries a typical operator. Markdown headings deliberately do not count.
const CODE_LINE_RE = /(?:[;{}]\s*$|^\s*(?:import|export|from|use|fn|def|class|const|let|var|pub|struct|impl|if|for|while|return)\b|^\s*\$ |^\s*\/\/|=>|::|\)\s*$)/;

export function looksLikeCode(text: string): boolean {
  if (text.startsWith("#!")) return true;
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return false;
  const hits = lines.filter((l) => CODE_LINE_RE.test(l)).length;
  return hits / lines.length >= CODE_SCORE_THRESHOLD;
}

// Where colour applies: inside ``` fences always (the fence lines themselves stay plain); with no fences at
// all, the whole note when it scores as code, otherwise nowhere.
export function codeRegions(text: string): Region[] {
  const regions: Region[] = [];
  let open: number | null = null; // offset just after the opening fence line
  let pos = 0;
  for (const line of text.split("\n")) {
    const next = pos + line.length + 1;
    if (/^\s*```/.test(line)) {
      if (open === null) open = next;
      else { regions.push({ start: open, end: pos }); open = null; }
    }
    pos = next;
  }
  if (open !== null) regions.push({ start: open, end: text.length });
  if (regions.length > 0 || !looksLikeCode(text)) return regions;
  return [{ start: 0, end: text.length }];
}

// The note as the overlay renders it: plain stretches and tokenized code stretches, in document order.
export function overlaySegments(text: string): (string | Token[])[] {
  if (text.length > MAX_HIGHLIGHT_CHARS) return [text];
  const out: (string | Token[])[] = [];
  let pos = 0;
  for (const r of codeRegions(text)) {
    if (r.start > pos) out.push(text.slice(pos, r.start));
    out.push(tokenize(text.slice(r.start, r.end)));
    pos = r.end;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

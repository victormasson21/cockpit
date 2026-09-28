// highlight.test.ts — colour-only tokenizing, fence/heuristic region detection, overlay segmenting.
import { describe, expect, it } from "vitest";
import { codeRegions, looksLikeCode, overlaySegments, tokenize, MAX_HIGHLIGHT_CHARS, type Token } from "./highlight";

const kinds = (code: string) => tokenize(code).filter((t) => t.kind !== "text").map((t) => `${t.kind}:${t.text}`);
const joined = (tokens: Token[]) => tokens.map((t) => t.text).join("");

describe("tokenize", () => {
  it("reassembles to the exact input, whatever it was given", () => {
    const sample = "const x = 'a'; // hi\n/* multi\nline */ fn main() { 0xff + 3.14 }\n#!/bin/sh\ndon't";
    expect(joined(tokenize(sample))).toBe(sample);
  });
  it("colours line and block comments", () => {
    expect(kinds("// hi")).toEqual(["comment:// hi"]);
    expect(kinds("a /* b\nc */ d")).toEqual(["comment:/* b\nc */"]);
    expect(kinds("# a note")).toEqual(["comment:# a note"]);
  });
  it("does not treat a URL's // as a comment", () => {
    expect(tokenize("https://linear.app/x").some((t) => t.kind === "comment")).toBe(false);
  });
  it("leaves rust attributes, css hex colours and #include alone", () => {
    expect(kinds("#[derive(Debug)]")).toEqual(["punct:[", "punct:(", "punct:)", "punct:]"]);
    expect(kinds("color: #fff")).toEqual(["punct::"]);
    expect(kinds("#include <x>")).toEqual(["punct:<", "punct:>"]);
  });
  it("colours terminated strings of all three quote kinds, honouring escapes", () => {
    expect(kinds(`"a\\"b" 'c' \`d\``)).toEqual(['string:"a\\"b"', "string:'c'", "string:`d`"]);
  });
  it("leaves an unterminated quote as text — an apostrophe in prose never eats the line", () => {
    expect(kinds("don't panic")).toEqual([]);
    expect(kinds('say "hi')).toEqual([]);
  });
  it("colours numbers but not digits inside identifiers", () => {
    expect(kinds("42 3.14 0xff 1e9 v2 ENG-1234")).toEqual(["number:42", "number:3.14", "number:0xff", "number:1e9", "punct:-", "number:1234"]);
  });
  it("colours shared keywords and leaves other identifiers plain", () => {
    expect(kinds("const fn def return foo")).toEqual(["keyword:const", "keyword:fn", "keyword:def", "keyword:return"]);
  });
  it("merges adjacent plain runs into one token", () => {
    expect(tokenize("foo bar baz")).toEqual([{ kind: "text", text: "foo bar baz" }]);
  });
  it("gives nothing back for an empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("looksLikeCode", () => {
  it("rejects prose", () => {
    expect(looksLikeCode("Hi team, quick update on the release.\nWe shipped the fix for the login bug.\nThanks!")).toBe(false);
  });
  it("accepts typescript", () => {
    expect(looksLikeCode("import { x } from './x';\nexport function f() {\n  return x;\n}")).toBe(true);
  });
  it("accepts a shell snippet", () => {
    expect(looksLikeCode("$ git status\n$ git log --oneline\n")).toBe(true);
  });
  it("accepts anything with a shebang", () => {
    expect(looksLikeCode("#!/bin/bash\necho hi")).toBe(true);
  });
  it("rejects a mixed note that is mostly prose", () => {
    expect(looksLikeCode("Here is what I ran:\nand it printed this line\nthen another line\nfoo();")).toBe(false);
  });
  it("rejects an empty note", () => {
    expect(looksLikeCode("")).toBe(false);
  });
});

describe("codeRegions", () => {
  it("returns the inside of a fenced block, excluding the fence lines", () => {
    const text = "intro\n```ts\nconst a = 1;\n```\noutro";
    expect(codeRegions(text)).toEqual([{ start: 12, end: 25 }]);
    expect(text.slice(12, 25)).toBe("const a = 1;\n");
  });
  it("runs an unterminated fence to the end", () => {
    const text = "intro\n```\nx";
    expect(codeRegions(text)).toEqual([{ start: 10, end: 11 }]);
  });
  it("returns nothing for fence-less prose", () => {
    expect(codeRegions("Hi team, quick update.\nThanks!")).toEqual([]);
  });
  it("returns the whole note when fence-less and it scores as code", () => {
    const text = "const a = 1;\nconst b = 2;";
    expect(codeRegions(text)).toEqual([{ start: 0, end: text.length }]);
  });
  it("prefers fences over the heuristic: prose around a fence stays plain even if code-heavy", () => {
    const text = "const a = 1;\n```\nx = 2;\n```\n";
    expect(codeRegions(text)).toEqual([{ start: 17, end: 24 }]);
  });
});

describe("overlaySegments", () => {
  it("interleaves plain stretches and tokenized code stretches in order", () => {
    const segs = overlaySegments("intro\n```\nx = 1;\n```\n");
    expect(segs[0]).toBe("intro\n```\n");
    expect(Array.isArray(segs[1])).toBe(true);
    expect(segs[2]).toBe("```\n");
  });
  it("returns the whole text plain above the size cap", () => {
    const big = "x = 1;\n".repeat(MAX_HIGHLIGHT_CHARS / 7 + 1);
    expect(overlaySegments(big)).toEqual([big]);
  });
});

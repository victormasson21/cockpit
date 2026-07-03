// diffLines.test.ts — classifying unified-patch lines for colored rendering.
import { describe, it, expect } from "vitest";
import { parseHunks } from "./diffLines";

const PATCH = `diff --git a/src/foo.ts b/src/foo.ts
index 1234567..89abcde 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,6 +10,7 @@ function foo() {
   const x = 1;
+  const y = 2;
-  old();
   return x;
`;

describe("parseHunks", () => {
  it("keeps the hunk header and classifies +/-/context lines", () => {
    const lines = parseHunks(PATCH);
    expect(lines.map((l) => l.kind)).toEqual(["hunk", "ctx", "add", "del", "ctx"]);
    expect(lines[0].text).toContain("@@ -10,6 +10,7 @@");
    expect(lines[2].text).toBe("+  const y = 2;");
    expect(lines[3].text).toBe("-  old();");
  });

  it("drops all file-header lines (diff/index/---/+++)", () => {
    const lines = parseHunks(PATCH);
    expect(lines.some((l) => l.text.startsWith("diff --git"))).toBe(false);
    expect(lines.some((l) => l.text.startsWith("index "))).toBe(false);
    expect(lines.some((l) => l.text.startsWith("--- "))).toBe(false);
    expect(lines.some((l) => l.text.startsWith("+++ "))).toBe(false);
  });

  it("does not misclassify --- / +++ headers as del/add", () => {
    // Regression: header markers must be dropped BEFORE the +/- check.
    const lines = parseHunks("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n");
    expect(lines.map((l) => l.kind)).toEqual(["hunk", "del", "add"]);
  });

  it("drops new/deleted-file and rename headers", () => {
    const lines = parseHunks("diff --git a/n b/n\nnew file mode 100644\n@@ -0,0 +1 @@\n+hi\n");
    expect(lines.map((l) => l.kind)).toEqual(["hunk", "add"]);
  });

  it("empty patch → no lines", () => {
    expect(parseHunks("")).toEqual([]);
  });
});

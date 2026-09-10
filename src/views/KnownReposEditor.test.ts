// KnownReposEditor.test.ts — the host-merge rule that keeps a HostConfig complete as fields are edited one
// at a time, and the report a multi-folder pick shows once discovery has resolved it to repo roots.
import { describe, it, expect } from "vitest";
import { mergeHost, summarisePicks } from "./KnownReposEditor";

describe("mergeHost", () => {
  it("seeds both fields when there is no existing host", () => {
    expect(mergeHost(undefined, { startCmd: "pnpm install && pnpm run dev" })).toEqual({
      startCmd: "pnpm install && pnpm run dev",
      address: "",
    });
  });

  it("preserves the untouched half when patching one field", () => {
    const current = { startCmd: "pnpm run dev", address: "http://localhost:5173" };
    expect(mergeHost(current, { address: "http://localhost:3000" })).toEqual({
      startCmd: "pnpm run dev",
      address: "http://localhost:3000",
    });
  });
});

describe("summarisePicks", () => {
  it("returns the repos not already known", () => {
    const got = summarisePicks(["/r/a", "/r/b"], ["/r/b"]);
    expect(got.added).toEqual(["/r/a"]);
  });

  it("counts the already-known ones in the message", () => {
    const got = summarisePicks(["/r/a", "/r/b"], ["/r/b"]);
    expect(got.message).toBe("Added 1 · 1 already known");
  });

  it("says so when the selection held no repos", () => {
    const got = summarisePicks([], ["/r/b"]);
    expect(got).toEqual({ added: [], message: "No git repos found in the selection" });
  });
});

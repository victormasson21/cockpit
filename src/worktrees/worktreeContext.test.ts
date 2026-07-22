import { describe, it, expect } from "vitest";
import { effectiveContext, DEFAULT_CONTEXTS } from "./worktreeContext";

describe("effectiveContext", () => {
  it("returns the configured value when the key exists", () => {
    expect(effectiveContext("todo", { todo: "custom text" })).toBe("custom text");
  });
  it("a configured empty string overrides the default (cleared field = no context)", () => {
    expect(effectiveContext("pr-review", { "pr-review": "" })).toBe("");
  });
  it("falls back to the shipped default when the key is absent", () => {
    expect(effectiveContext("pr-review", {})).toBe(DEFAULT_CONTEXTS["pr-review"]);
    expect(effectiveContext("todo", undefined)).toBe(DEFAULT_CONTEXTS["todo"]);
  });
  it("returns empty string for a source with no default and no config", () => {
    expect(effectiveContext("slack", {})).toBe("");
    expect(effectiveContext("manual", {})).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import { filterConversations } from "./watchFilter";
import type { ConversationMeta } from "./types";

const ch = (id: string, name: string): ConversationMeta => ({ id, name, kind: "channel" });

describe("filterConversations", () => {
  it("matches names case-insensitively as a substring", () => {
    const convs = [ch("C1", "General"), ch("C2", "incidents"), ch("C3", "eng-general")];
    expect(filterConversations(convs, "GEN").map((c) => c.id)).toEqual(["C1", "C3"]);
  });

  it("returns everything for an empty query", () => {
    const convs = [ch("C1", "a"), ch("C2", "b")];
    expect(filterConversations(convs, "  ").map((c) => c.id)).toEqual(["C1", "C2"]);
  });

  it("includes DMs whose name matches (channels + DMs are both pickable)", () => {
    const convs: ConversationMeta[] = [ch("C1", "alice"), { id: "D1", name: "Alice Cooper", kind: "im" }];
    expect(filterConversations(convs, "alice").map((c) => c.id)).toEqual(["C1", "D1"]);
  });

  it("does not mutate its input", () => {
    const convs = [ch("C1", "keep"), ch("C2", "drop")];
    filterConversations(convs, "keep");
    expect(convs.map((c) => c.id)).toEqual(["C1", "C2"]);
  });
});

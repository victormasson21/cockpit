import { describe, it, expect } from "vitest";
import { sortByRecency } from "./rows";
import type { SlackConversation } from "./types";

const c = (id: string, ts: string): SlackConversation => ({
  id, kind: "channel", name: id, unreadCount: 1, latestText: "", latestTs: ts,
});

describe("sortByRecency", () => {
  it("orders newest ts first without mutating input", () => {
    const input = [c("a", "100.1"), c("b", "300.2"), c("d", "200.0")];
    const out = sortByRecency(input);
    expect(out.map((x) => x.id)).toEqual(["b", "d", "a"]);
    expect(input.map((x) => x.id)).toEqual(["a", "b", "d"]); // input untouched
  });
});

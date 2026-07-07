// merge.test.ts — mergePrItems: dedupe incoming by url, prepend, keep existing order.
import { describe, expect, test } from "vitest";
import { mergePrItems } from "./merge";
import type { PrReviewItem } from "../../settings/types";

const item = (id: string, url: string): PrReviewItem => ({
  id,
  url,
  repo: "web-app",
  number: 1,
  title: "t",
  author: "a",
  ts: id,
});

describe("mergePrItems", () => {
  test("prepends incoming items ahead of existing ones", () => {
    const existing = [item("1", "u1")];
    const merged = mergePrItems(existing, [item("3", "u3"), item("2", "u2")]);
    expect(merged.map((i) => i.id)).toEqual(["3", "2", "1"]);
  });

  test("drops incoming items whose url is already listed (re-request of a listed PR)", () => {
    const existing = [item("1", "u1")];
    const merged = mergePrItems(existing, [item("2", "u1"), item("3", "u3")]);
    expect(merged.map((i) => i.id)).toEqual(["3", "1"]);
  });

  test("dedupes within the incoming batch (same PR re-pinged between refreshes)", () => {
    const merged = mergePrItems([], [item("2", "u1"), item("1", "u1")]);
    expect(merged.map((i) => i.id)).toEqual(["2"]);
  });

  test("empty incoming returns the existing array unchanged", () => {
    const existing = [item("1", "u1")];
    expect(mergePrItems(existing, [])).toEqual(existing);
  });
});

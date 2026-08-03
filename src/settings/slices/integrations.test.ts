// integrations.test.ts — the Slack + PR Reviews config slice. The recurring contract: every writer must
// preserve its sibling integration's fields, since they share one `integrations` object.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }));

import { useSettings } from "../store";
import { baseCockpit, resetStore } from "./fixtures";

const withSlack = () => ({
  cockpit: {
    ...structuredClone(baseCockpit),
    integrations: { slack: { clientId: "c1", watchedChannelIds: ["C0"] } },
  },
});

describe("slack config actions", () => {
  beforeEach(() => resetStore(withSlack()));

  it("setSlackClientId keeps the watched list", () => {
    useSettings.getState().setSlackClientId("c2");
    expect(useSettings.getState().cockpit.integrations?.slack).toEqual({ clientId: "c2", watchedChannelIds: ["C0"] });
  });

  it("setSlackWatched keeps the client id", () => {
    useSettings.getState().setSlackWatched(["C1", "D2"]);
    expect(useSettings.getState().cockpit.integrations?.slack).toEqual({ clientId: "c1", watchedChannelIds: ["C1", "D2"] });
  });
});

describe("PR reviews actions", () => {
  const item = (id: string, url: string) => ({
    id, url, repo: "web-app", number: 1, title: "t", author: "a", ts: id,
  });

  beforeEach(() => resetStore(withSlack()));

  it("setPrChannel sets the channel, clears the cursor, keeps items and the slack sibling", () => {
    useSettings.setState((st) => ({
      cockpit: { ...st.cockpit, integrations: { ...st.cockpit.integrations, prReviews: { channelId: "C1", lastSeenTs: "9.9", items: [item("1", "u1")] } } },
    }));
    useSettings.getState().setPrChannel("C2");
    const c = useSettings.getState().cockpit;
    expect(c.integrations?.prReviews).toEqual({ channelId: "C2", items: [item("1", "u1")] });
    expect(c.integrations?.slack?.clientId).toBe("c1");
  });

  it("setPrChannel(null) clears the channel", () => {
    useSettings.getState().setPrChannel("C1");
    useSettings.getState().setPrChannel(null);
    expect(useSettings.getState().cockpit.integrations?.prReviews?.channelId).toBeUndefined();
  });

  it("applyPrFetch merges new items on top and advances the cursor", () => {
    useSettings.getState().setPrChannel("C1");
    useSettings.getState().applyPrFetch([item("2", "u2")], "2");
    useSettings.getState().applyPrFetch([item("3", "u3")], "3");
    const pr = useSettings.getState().cockpit.integrations?.prReviews;
    expect(pr?.items.map((i) => i.id)).toEqual(["3", "2"]);
    expect(pr?.lastSeenTs).toBe("3");
  });

  it("applyPrFetch without a newestTs keeps the existing cursor", () => {
    useSettings.getState().setPrChannel("C1");
    useSettings.getState().applyPrFetch([item("2", "u2")], "2");
    useSettings.getState().applyPrFetch([], undefined);
    expect(useSettings.getState().cockpit.integrations?.prReviews?.lastSeenTs).toBe("2");
  });

  it("removePrItem drops only the matching item", () => {
    useSettings.getState().setPrChannel("C1");
    useSettings.getState().applyPrFetch([item("2", "u2"), item("1", "u1")], "2");
    useSettings.getState().removePrItem("1");
    expect(useSettings.getState().cockpit.integrations?.prReviews?.items.map((i) => i.id)).toEqual(["2"]);
  });
});

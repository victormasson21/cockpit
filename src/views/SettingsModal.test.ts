// SettingsModal.test.ts — the host-merge rule that keeps a HostConfig complete as fields are edited one at a time.
import { describe, it, expect } from "vitest";
import { mergeHost } from "./SettingsModal";

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

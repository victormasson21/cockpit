// version.test.ts — the header version label: "v<semver>" in a real build, "· dev" suffix in local dev.
import { describe, it, expect } from "vitest";
import { versionLabel } from "./version";

describe("versionLabel", () => {
  it("shows the bare version in a production build", () => {
    expect(versionLabel("0.1.0", false)).toBe("v0.1.0");
  });
  it("marks local dev next to the version", () => {
    expect(versionLabel("0.1.0", true)).toBe("v0.1.0 · dev");
  });
  it("shows just dev while the version hasn't resolved yet in dev", () => {
    expect(versionLabel(null, true)).toBe("dev");
  });
  it("shows nothing while the version hasn't resolved in a build", () => {
    expect(versionLabel(null, false)).toBe("");
  });
});

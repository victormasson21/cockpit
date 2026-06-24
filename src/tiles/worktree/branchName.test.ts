// branchName.test.ts — pure default-name derivation for the existing-branch form.
import { describe, it, expect } from "vitest";
import { deriveBranchName } from "./branchName";

describe("deriveBranchName", () => {
  it("uses the last path segment of a slashed branch", () => {
    expect(deriveBranchName("feature/login-fix")).toBe("login-fix");
    expect(deriveBranchName("victor/eng-1234-thing")).toBe("eng-1234-thing");
  });
  it("returns the branch unchanged when there is no slash", () => {
    expect(deriveBranchName("main")).toBe("main");
  });
  it("returns empty string for empty input", () => {
    expect(deriveBranchName("")).toBe("");
  });
});

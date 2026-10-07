// notes.test.ts — the notepad tiles slice: renaming materialises the synthesised default note.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api", () => ({ saveSettings: vi.fn().mockResolvedValue(undefined) }));

import { useSettings } from "../store";
import { resetStore } from "./fixtures";
import { DEFAULT_NOTE, notesOf } from "./notes";

describe("notes", () => {
  beforeEach(() => resetStore());

  it("notesOf resolves an absent or empty list to the default note", () => {
    expect(notesOf(undefined)).toEqual([DEFAULT_NOTE]);
    expect(notesOf([])).toEqual([DEFAULT_NOTE]);
  });

  it("renameNote on a fresh config persists the default note under its new title", () => {
    useSettings.getState().renameNote(DEFAULT_NOTE.id, "  Ideas  ");
    expect(useSettings.getState().cockpit.notes).toEqual([{ id: DEFAULT_NOTE.id, title: "Ideas" }]);
  });

  it("renameNote with a blank title keeps the old one", () => {
    useSettings.getState().renameNote(DEFAULT_NOTE.id, "Ideas");
    useSettings.getState().renameNote(DEFAULT_NOTE.id, "   ");
    expect(useSettings.getState().cockpit.notes).toEqual([{ id: DEFAULT_NOTE.id, title: "Ideas" }]);
  });
});

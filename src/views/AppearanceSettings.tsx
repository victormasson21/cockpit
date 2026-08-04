// AppearanceSettings.tsx — Settings › Appearance: picks the app background from the registry.
import { useSettings } from "../settings/store";
import { BACKGROUNDS, NO_BACKGROUND } from "../background/registry";
import { Dropdown } from "./Dropdown";

export function AppearanceSettings() {
  const current = useSettings((s) => s.cockpit.preferences.background);
  const setBackground = useSettings((s) => s.setBackground);
  return (
    <div className="appearance">
      <label className="appearance__label" htmlFor="background">Background</label>
      <Dropdown
        variant="form"
        placeholder="None"
        // Off is a real, persisted choice rather than a cleared field, so it survives a future
        // change of default — hence a row, not a null value.
        value={current ?? NO_BACKGROUND}
        onChange={(id) => setBackground(id)}
        groups={[{ options: [
          { value: NO_BACKGROUND, label: "None" },
          ...BACKGROUNDS.map((b) => ({ value: b.id, label: b.label })),
        ] }]}
      />
      <p className="appearance__hint">Shows behind every view — most visible in Cockpit and Calm, which leave the most space.</p>
    </div>
  );
}

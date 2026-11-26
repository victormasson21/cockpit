// ThemeToggle.tsx — header button that flips between the Day and Night themes and persists the choice.
import { useSettings } from "../settings/store";
import { themeFor, DAY_THEME } from "../theme/ThemeProvider";
import { MoonIcon, SunIcon } from "./icons";

export function ThemeToggle() {
  const isDay = themeFor(useSettings((s) => s.cockpit.preferences.theme)) === DAY_THEME;
  const setTheme = useSettings((s) => s.setTheme);
  return (
    <button
      className="app__new app__new--icon"
      aria-label={isDay ? "switch to night mode" : "switch to day mode"}
      title={isDay ? "Night mode" : "Day mode"}
      onClick={() => setTheme(isDay ? "dark" : "light")}
    >
      {isDay ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

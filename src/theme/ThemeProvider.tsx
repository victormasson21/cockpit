// ThemeProvider.tsx — brands the root element with the active theme and loads its CSS + fonts.
// Adding a theme later = a new tokens file + an entry here; components never change.
import { useEffect, type ReactNode } from "react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./deepSlate.css";
import "./day.css";
import { useSettings } from "../settings/store";
import type { Preferences } from "../settings/types";

export const NIGHT_THEME = "deep-slate";
export const DAY_THEME = "day";

export function themeFor(pref: Preferences["theme"]): string {
  return pref === "light" ? DAY_THEME : NIGHT_THEME;
}

// Split out so the branding step is unit-testable without a DOM.
export function applyTheme(root: { setAttribute(name: string, value: string): void }, theme: string) {
  root.setAttribute("data-theme", theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = themeFor(useSettings((s) => s.cockpit.preferences.theme));
  // data-theme on <html> so :root[data-theme=…] tokens apply to the whole document (incl. portals).
  useEffect(() => {
    applyTheme(document.documentElement, theme);
  }, [theme]);
  return <>{children}</>;
}

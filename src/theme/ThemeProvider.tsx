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

export const THEME = "deep-slate"; // single theme for now; the token contract supports more.

// Split out so the branding step is unit-testable without a DOM.
export function applyTheme(root: { setAttribute(name: string, value: string): void }) {
  root.setAttribute("data-theme", THEME);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // data-theme on <html> so :root[data-theme=…] tokens apply to the whole document (incl. portals).
  useEffect(() => {
    applyTheme(document.documentElement);
  }, []);
  return <>{children}</>;
}

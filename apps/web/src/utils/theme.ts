export type ThemeMode = "dark" | "light" | "system";

const THEME_KEY = "conjiweb-theme";

function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return mode;
}

export function getStoredTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light" || saved === "system") return saved;
  return "dark";
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved === "dark");
  localStorage.setItem(THEME_KEY, mode);
}


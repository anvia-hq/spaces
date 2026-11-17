export const THEME_KEY = "anvia-theme";

const THEME_COLOR = { light: "#f4f4f5", dark: "#09090b" } as const;
const FAVICON = { light: "/favicon-light.svg", dark: "/favicon.svg" } as const;

export function readStoredTheme(): "light" | "dark" {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function storeTheme(theme: "light" | "dark") {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (error) {
    console.warn("anvia-theme could not be saved", error);
  }
}

export function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  document.querySelector('link[rel="icon"]')?.setAttribute("href", FAVICON[theme]);
}

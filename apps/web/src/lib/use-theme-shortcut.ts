import { useEffect } from "react";
import { applyTheme, readStoredTheme, storeTheme } from "@/lib/theme.ts";

export function useThemeShortcut() {
  useEffect(() => {
    applyTheme(readStoredTheme());

    function onKeyDown(event: KeyboardEvent) {
      if (!isToggleKey(event)) return;

      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      storeTheme(next);
      applyTheme(next);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

function isToggleKey(event: KeyboardEvent) {
  return (
    event.key.toLowerCase() === "d" &&
    !event.defaultPrevented &&
    !event.repeat &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !isEditable(event.target)
  );
}

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

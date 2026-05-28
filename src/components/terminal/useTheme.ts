import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

/** Read/toggle the data-theme set on <html> by the no-FOUC bootstrap. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const cur =
      (document.documentElement.getAttribute("data-theme") as Theme) || "light";
    setTheme(cur);
  }, []);

  const toggle = () => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("compass-theme", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return { theme, toggle };
}

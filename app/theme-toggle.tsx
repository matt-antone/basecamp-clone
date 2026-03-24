"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

const THEME_KEY = "basecamp-clone-theme";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      applyTheme(saved);
      return;
    }
    const systemTheme: Theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(systemTheme);
    applyTheme(systemTheme);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <div className="themeTopBar">
      <Link href="/" className="brandLink" aria-label="Go to home">
        <Image src="/gx-logo.webp" alt="GX Logo" width={120} height={28} priority className="brandLogo" />
        &nbsp; Project Manager
      </Link>
      <button type="button" className="themeToggleButton" onClick={toggleTheme}>
        {theme === "light" ? "Switch to Dark" : "Switch to Light"}
      </button>
    </div>
  );
}

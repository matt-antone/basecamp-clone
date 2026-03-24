"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const THEME_KEY = "basecamp-clone-theme";

type Theme = "light" | "dark";
type SessionUser = { id: string; email?: string };

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [user, setUser] = useState<SessionUser | null>(null);

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

  useEffect(() => {
    let mounted = true;
    let supabase: ReturnType<typeof getSupabaseBrowserClient> | null = null;

    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email } : null);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
  }

  async function signOut() {
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      setUser(null);
      window.location.href = "/";
    } catch {
      // Keep header controls stable if sign-out fails.
    }
  }

  return (
    <div className="themeTopBar">
      <Link href="/" className="brandHomeLink" aria-label="Go to home">
        <Image src="/gx-logo.webp" alt="GX Logo" width={120} height={28} priority className="brandLogo" />
      </Link>
      <Link href="/" className="brandLink" aria-label="Project Manager home">
        Project Manager
      </Link>
      <div className="themeTopBarActions">
        {user && (
          <>
            <Link href="/settings" className="themeHeaderButton themeHeaderButtonSecondary">
              Settings
            </Link>
            <button type="button" className="themeHeaderButton themeHeaderButtonGhost" onClick={signOut}>
              Sign out
            </button>
          </>
        )}
        <button type="button" className="themeToggleButton" onClick={toggleTheme}>
          {theme === "light" ? "Switch to Dark" : "Switch to Light"}
        </button>
      </div>
    </div>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const THEME_KEY = "basecamp-clone-theme";

type Theme = "light" | "dark";
type SessionUser = { id: string; email?: string };
type ProjectStats = {
  active: number;
  blocked: number;
  archived: number;
};

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null);

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
      setAccessToken(data.session?.access_token ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email } : null);
      setAccessToken(session?.access_token ?? null);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user || !accessToken) {
      setProjectStats(null);
      return;
    }

    let canceled = false;

    async function loadProjectStats() {
      const response = await fetch("/projects?includeArchived=true", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      if (!response.ok) {
        throw new Error(`Unable to load project stats (${response.status})`);
      }

      const data = (await response.json()) as {
        projects?: Array<{ archived?: boolean; status?: string | null }>;
      };
      if (canceled) {
        return;
      }

      const projects = data.projects ?? [];
      setProjectStats({
        active: projects.filter((project) => !project.archived).length,
        blocked: projects.filter((project) => !project.archived && (project.status ?? "").toLowerCase() === "blocked").length,
        archived: projects.filter((project) => project.archived).length
      });
    }

    loadProjectStats().catch(() => {
      if (!canceled) {
        setProjectStats(null);
      }
    });

    return () => {
      canceled = true;
    };
  }, [user, accessToken]);

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
      setAccessToken(null);
      setProjectStats(null);
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
      <div className="brandCluster">
        <Link href="/" className="brandLink" aria-label="Project Manager home">
          Project Manager
        </Link>
        {user && projectStats && (
          <div className="brandStats" aria-label="Project summary">
            <span className="brandStatChip">{projectStats.active} active</span>
            <span className="brandStatChip">{projectStats.blocked} blocked</span>
            <span className="brandStatChip">{projectStats.archived} archived</span>
          </div>
        )}
      </div>
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

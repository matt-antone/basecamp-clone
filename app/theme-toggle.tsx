"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { authedJsonFetch, fetchAuthSession } from "@/lib/browser-auth";

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
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);

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
    let cancelled = false;

    fetchAuthSession()
      .then((session) => {
        if (cancelled) return;
        setUser(session.user);
        setAccessToken(session.accessToken);
        setIsAuthReady(true);
        setIsSigningIn(false);
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setAccessToken(null);
        setIsAuthReady(true);
        setIsSigningIn(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user || !accessToken) {
      setProjectStats(null);
      return;
    }

    let canceled = false;

    async function loadProjectStats() {
      const response = await authedJsonFetch({
        accessToken,
        onToken: setAccessToken,
        path: "/projects?includeArchived=true"
      });
      const data = (response.data ?? null) as {
        projects?: Array<{ archived?: boolean; status?: string | null }>;
      };
      if (canceled || !data) {
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

  async function signIn() {
    try {
      setIsSigningIn(true);
      window.location.href = "/auth/google/start";
    } catch {
      setIsSigningIn(false);
    }
  }

  async function signOut() {
    setUser(null);
    setAccessToken(null);
    setProjectStats(null);
    window.location.href = "/auth/logout";
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
        {isAuthReady && !user && (
          <button
            type="button"
            className="themeHeaderButton themeHeaderButtonPrimary"
            onClick={signIn}
            disabled={isSigningIn}
          >
            {isSigningIn ? "Signing in..." : "Sign in"}
          </button>
        )}
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

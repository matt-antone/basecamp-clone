"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authedJsonFetch, fetchAuthSession } from "@/lib/browser-auth";

const THEME_KEY = "basecamp-clone-theme";
const DEFAULT_SITE_TITLE = "Project Manager";
const DEFAULT_LOGO_URL = "/gx-logo.webp";

type Theme = "light" | "dark";
type SessionUser = { id: string; email?: string };
type ProjectStats = {
  active: number;
  blocked: number;
  archived: number;
};
type SiteSettingsPayload = {
  siteTitle: string | null;
  logoUrl: string | null;
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
  const [siteSettings, setSiteSettings] = useState<SiteSettingsPayload>({
    siteTitle: DEFAULT_SITE_TITLE,
    logoUrl: DEFAULT_LOGO_URL
  });
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

    async function loadSiteSettings() {
      try {
        const response = await fetch("/site-settings", {
          cache: "no-store",
          credentials: "same-origin"
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json().catch(() => null)) as
          | {
              siteSettings?: {
                siteTitle?: string | null;
                logoUrl?: string | null;
                site_title?: string | null;
                logo_url?: string | null;
              };
            }
          | null;
        const source = payload?.siteSettings ?? null;
        if (!source || cancelled) {
          return;
        }

        const rawTitle = source.siteTitle ?? source.site_title ?? null;
        const rawLogo = source.logoUrl ?? source.logo_url ?? null;
        const nextTitle = typeof rawTitle === "string" ? rawTitle.trim() : "";
        const nextLogo = typeof rawLogo === "string" ? rawLogo.trim() : "";

        setSiteSettings({
          siteTitle: nextTitle || DEFAULT_SITE_TITLE,
          logoUrl: nextLogo || DEFAULT_LOGO_URL
        });
      } catch {
        /* Keep fallback branding if settings cannot be loaded. */
      }
    }

    loadSiteSettings().catch(() => {
      /* Keep fallback branding if settings cannot be loaded. */
    });

    return () => {
      cancelled = true;
    };
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
        <img src={siteSettings.logoUrl || DEFAULT_LOGO_URL} alt={`${siteSettings.siteTitle} logo`} className="brandLogo" />
      </Link>
      <div className="brandCluster">
        <Link href="/" className="brandLink" aria-label={`${siteSettings.siteTitle} home`}>
          {siteSettings.siteTitle}
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

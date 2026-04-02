"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { OneShotButton } from "@/components/one-shot-button";
import { authedJsonFetch, fetchAuthSession } from "@/lib/browser-auth";
import { projectsNavHighlight } from "@/lib/projects-view-path";
import { DEFAULT_SITE_LOGO_URL, DEFAULT_SITE_TITLE, normalizeSiteLogoUrl, normalizeSiteTitle } from "@/lib/site-branding";

const THEME_KEY = "basecamp-clone-theme";

type Theme = "light" | "dark";
type SessionUser = { id: string; email?: string };
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

export default function SiteHeader() {
  const pathname = usePathname();
  const projectsNavActive = projectsNavHighlight(pathname);

  const [theme, setTheme] = useState<Theme>("light");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [billingStageCount, setBillingStageCount] = useState<number | null>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettingsPayload>({
    siteTitle: DEFAULT_SITE_TITLE,
    logoUrl: DEFAULT_SITE_LOGO_URL
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

        setSiteSettings({
          siteTitle: normalizeSiteTitle(rawTitle),
          logoUrl: normalizeSiteLogoUrl(rawLogo)
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
      setBillingStageCount(null);
      return;
    }

    let cancelled = false;

    async function loadBillingCount() {
      try {
        const { data } = await authedJsonFetch({
          accessToken,
          onToken: setAccessToken,
          path: "/projects/billing-count"
        });
        const raw = (data as { count?: unknown })?.count;
        const count = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
        if (!cancelled) {
          setBillingStageCount(count);
        }
      } catch {
        if (!cancelled) {
          setBillingStageCount(null);
        }
      }
    }

    void loadBillingCount();

    function onVisibility() {
      if (document.visibilityState === "visible") {
        void loadBillingCount();
      }
    }

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, accessToken, pathname]);

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
    window.location.href = "/auth/logout";
  }

  return (
    <div className="themeTopBar">
      <div className="brandCluster">
        <Link href="/" className="brandHomeLink" aria-label="Go to home">
          <img src={siteSettings.logoUrl || DEFAULT_SITE_LOGO_URL} alt={`${siteSettings.siteTitle} logo`} className="brandLogo" />
        </Link>
        <Link href="/" className="brandLink" aria-label={`${siteSettings.siteTitle} home`}>
          {siteSettings.siteTitle}
        </Link>
      </div>
      <div className="themeTopBarActions">
        {user && (
          <nav className="themeTopBarProjectsNav" aria-label="Projects views">
            <Link
              href="/"
              className={`themeTopBarProjectsLink ${projectsNavActive === "list" ? "themeTopBarProjectsLinkActive" : ""}`}
              scroll={false}
            >
              Projects
            </Link>
            <Link
              href="/flow"
              className={`themeTopBarProjectsLink ${projectsNavActive === "board" ? "themeTopBarProjectsLinkActive" : ""}`}
              scroll={false}
            >
              Project Board
            </Link>
            <Link
              href="/billing"
              className={`themeTopBarProjectsLink ${projectsNavActive === "billing" ? "themeTopBarProjectsLinkActive" : ""}`}
              scroll={false}
            >
              Billing
              {billingStageCount !== null && billingStageCount > 0 ? (
                <span className="themeTopBarProjectsBadge" aria-label={`${billingStageCount} in billing`}>
                  {billingStageCount > 99 ? "99+" : billingStageCount}
                </span>
              ) : null}
            </Link>
            <Link
              href="/archive"
              className={`themeTopBarProjectsLink ${projectsNavActive === "archived" ? "themeTopBarProjectsLinkActive" : ""}`}
              scroll={false}
            >
              Archive
            </Link>
          </nav>
        )}
        {isAuthReady && !user && (
          <OneShotButton
            type="button"
            className="themeHeaderButton themeHeaderButtonPrimary"
            onClick={signIn}
            disabled={isSigningIn}
          >
            {isSigningIn ? "Signing in..." : "Sign in"}
          </OneShotButton>
        )}
        {user && (
          <>
            <Link href="/settings" className="themeHeaderButton themeHeaderButtonSecondary">
              Settings
            </Link>
            <OneShotButton type="button" className="themeHeaderButton themeHeaderButtonGhost" onClick={signOut}>
              Sign out
            </OneShotButton>
          </>
        )}
        <OneShotButton type="button" className="themeToggleButton" onClick={toggleTheme}>
          {theme === "light" ? "Switch to Dark" : "Switch to Light"}
        </OneShotButton>
      </div>
    </div>
  );
}

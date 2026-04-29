type ProjectsViewTab = "list" | "board" | "billing" | "archived";

/** Maps App Router pathname to the projects workbench tab (Index / Flow / Archive). */
export function projectsViewTabFromPathname(pathname: string | null): ProjectsViewTab {
  if (!pathname || pathname === "/") {
    return "list";
  }
  if (pathname === "/flow" || pathname.startsWith("/flow/")) {
    return "board";
  }
  if (pathname === "/billing" || pathname.startsWith("/billing/")) {
    return "billing";
  }
  if (pathname === "/archive" || pathname.startsWith("/archive/")) {
    return "archived";
  }
  return "list";
}

/** Top-bar highlight: no active item on project pages, settings, etc. */
export function projectsNavHighlight(pathname: string | null): ProjectsViewTab | null {
  if (!pathname || pathname === "/") {
    return "list";
  }
  if (pathname === "/flow" || pathname.startsWith("/flow/")) {
    return "board";
  }
  if (pathname === "/billing" || pathname.startsWith("/billing/")) {
    return "billing";
  }
  if (pathname === "/archive" || pathname.startsWith("/archive/")) {
    return "archived";
  }
  return null;
}

# Remove hero default-text flash (feed loading state) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the projects home hero from briefly showing placeholder marketing copy before `/feeds/latest` resolves by tracking an explicit feed loading state, showing a 16:9 loading region with the existing spinner style while loading, and only then showing feed content or the current default hero strings when the feed is empty or unreachable.

**Architecture:** Extend `ProjectsWorkspaceContext` with `featuredFeedStatus: "loading" | "ready"`. Initialize to `"loading"`, run the existing client-side `fetch("/feeds/latest")` path, and set `"ready"` in a `finally` block so both success and failure settle. `ProjectsWorkspaceShell` branches: while `featuredFeedStatus === "loading"` and `showHero`, render session line plus a 16:9 loading panel (spinner only, reusing `.loadingStateSpinner`). When `"ready"`, keep today’s behavior: if `latestFeaturedPosts[0]` exists, show feed hero; otherwise show the **same default kicker/title/intro strings** already defined in the shell as fallback.

**Tech Stack:** React 19 client components, TypeScript, Vitest, existing global CSS (`app/styles.css`), existing spinner class `.loadingStateSpinner`.

---

## File map

| File | Role |
|------|------|
| `components/projects/projects-workspace-context.tsx` | Add `featuredFeedStatus` state, type on context value, `useEffect` fetch lifecycle with `finally` → `ready` |
| `components/projects/projects-workspace-shell.tsx` | Conditional hero UI: loading branch vs ready branch; reuse default string constants for ready+empty |
| `app/styles.css` | `.projectsHeroFeedLoading`, `.projectsHeroLoadingPanel`, rail alignment so hero grid stays stable |
| `tests/unit/projects-workspace-shell-hero.test.tsx` | Mock `useProjectsWorkspace`; assert loading omits default title, ready+empty includes it |

---

### Task 1: Context — `featuredFeedStatus` state and fetch lifecycle

**Files:**
- Modify: `components/projects/projects-workspace-context.tsx`
- Test: manual / Task 4 automated tests

- [ ] **Step 1: Extend types and initial state**

In `ProjectsWorkspaceContextValue`, add:

```ts
featuredFeedStatus: "loading" | "ready";
```

Add state in `ProjectsWorkspaceInner`:

```ts
const [featuredFeedStatus, setFeaturedFeedStatus] = useState<"loading" | "ready">("loading");
```

Include `featuredFeedStatus` in the `value` object passed to `ProjectsWorkspaceContext.Provider`.

- [ ] **Step 2: Set `ready` in `finally` on the feed effect**

Locate the existing `useEffect` that calls `fetch("/feeds/latest", { cache: "force-cache" })` (around lines 215–232). Keep the success path that `setLatestFeaturedPosts(posts)` inside `startTransition`. Append a `.finally()` to the promise chain:

```ts
.finally(() => {
  if (cancelled) return;
  startTransition(() => {
    setFeaturedFeedStatus("ready");
  });
});
```

Remove any redundant `setFeaturedFeedStatus` from success-only paths so `ready` always runs after the request settles (success, HTTP error, or JSON parse issues — match current behavior where non-ok response leaves posts unchanged).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`  
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/projects/projects-workspace-context.tsx
git commit -m "feat(projects): add featuredFeedStatus for hero feed load lifecycle"
```

---

### Task 2: Shell — loading UI vs ready (default copy only after ready)

**Files:**
- Modify: `components/projects/projects-workspace-shell.tsx`

- [ ] **Step 1: Destructure `featuredFeedStatus`**

From `useProjectsWorkspace()`, add `featuredFeedStatus` alongside existing fields.

- [ ] **Step 2: Extract default copy constants (optional but DRY)**

At module scope (below imports), define the three fallback strings currently inlined when `featuredHeroPost` is null:

```ts
const HERO_FALLBACK_KICKER = "Projects index";
const HERO_FALLBACK_TITLE = "A calmer way to see what the studio is carrying.";
const HERO_FALLBACK_INTRO =
  "The page should read like an active portfolio wall, not a template dashboard. Track what is moving, what is blocked, and which client lanes need attention next.";
```

Use these in the **ready** branch for `!featuredHeroPost` so behavior matches today’s copy exactly.

- [ ] **Step 3: Branch rendering when `showHero`**

Define:

```ts
const showHeroFeedLoading = showHero && featuredFeedStatus === "loading";
```

When `showHeroFeedLoading` is true:

- Keep `<section className="projectsHero projectsHeroFeedLoading">` (add `projectsHeroFeedLoading` for styling).
- Render `projectsSessionNote` as today.
- **Do not** render `heroKicker`, `heroTitle`, `heroIntro`, or feed buttons.
- Replace the main copy block with a single loading panel:

```tsx
<div
  className="projectsHeroLoadingPanel"
  role="status"
  aria-live="polite"
  aria-label="Loading latest posts"
>
  <span className="loadingStateSpinner" aria-hidden="true" />
</div>
```

- In `<aside className="projectsFeedRail">`, omit the list and fallback paragraph; render a centered spinner (same `.loadingStateSpinner`, optionally add `inlineLoadingStateSpinner` for slightly smaller) inside a wrapper `div` with class `projectsFeedRailLoading` so CSS can center it.

When `showHero` is true and `showHeroFeedLoading` is false (**ready**):

- Keep existing logic: compute `featuredHeroPost`, `feedRailPosts`, and use feed-specific strings when `featuredHeroPost` is set; when not set, use `HERO_FALLBACK_*` constants for kicker/title/intro.
- Rail: unchanged from current (list or `projectsFeedFallback` when empty).

When `showHero` is false: unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/projects/projects-workspace-shell.tsx
git commit -m "feat(projects): show hero spinner until feed ready; keep default copy as fallback"
```

---

### Task 3: CSS — 16:9 loading panel and balanced rail

**Files:**
- Modify: `app/styles.css` (near existing `.projectsHero` rules, ~line 529)

- [ ] **Step 1: Loading layout rules**

Add after `.projectsHero` block (or grouped with it):

```css
.projectsHeroFeedLoading .projectsHeroCopy {
  display: grid;
  gap: 1rem;
  align-content: start;
}

.projectsHeroLoadingPanel {
  width: 100%;
  margin: 0;
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  border-radius: 0.75rem;
  border: 1px dashed color-mix(in oklch, var(--projects-border) 85%, transparent);
  background: color-mix(in oklch, var(--panel-bg) 88%, transparent);
}

.projectsHeroFeedLoading .projectsFeedRail {
  display: grid;
  align-content: center;
  justify-items: center;
  min-height: 100%;
}

.projectsFeedRailLoading {
  display: grid;
  place-items: center;
  padding: 1rem;
  min-height: 8rem;
}
```

Tune border/background to match existing hero surfaces; keep **16 / 9** on `.projectsHeroLoadingPanel` only.

- [ ] **Step 2: Reduced layout shift**

Ensure `.projectsHeroFeedLoading` does not remove padding from `.projectsHero` so width matches the ready state.

- [ ] **Step 3: Commit**

```bash
git add app/styles.css
git commit -m "style(projects): 16:9 hero loading panel and centered rail spinner"
```

---

### Task 4: Tests — shell respects loading vs ready

**Files:**
- Create: `tests/unit/projects-workspace-shell-hero.test.tsx`

- [ ] **Step 1: Add tests with mocked hook**

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ProjectsWorkspaceShell } from "@/components/projects/projects-workspace-shell";

const baseWorkspace = {
  status: "Signed in as test@example.com",
  domainAllowed: true,
  latestFeaturedPosts: [] as { url: string; sourceName: string; title: string; description: string; publishedAt: string | null }[],
  createDialogRef: { current: null },
  projectForm: {} as never,
  setProjectForm: vi.fn(),
  clients: [],
  isCreatingProject: false,
  createProject: vi.fn(),
  setStatus: vi.fn()
};

vi.mock("@/components/projects/projects-workspace-context", () => ({
  useProjectsWorkspace: vi.fn()
}));

import { useProjectsWorkspace } from "@/components/projects/projects-workspace-context";

describe("ProjectsWorkspaceShell hero feed loading", () => {
  beforeEach(() => {
    vi.mocked(useProjectsWorkspace).mockReturnValue({
      ...baseWorkspace,
      featuredFeedStatus: "loading"
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not render default hero title while feed is loading", () => {
    const markup = renderToStaticMarkup(
      <ProjectsWorkspaceShell viewport={<div />} />
    );
    expect(markup).not.toContain("A calmer way to see what the studio is carrying.");
    expect(markup).toContain("projectsHeroFeedLoading");
    expect(markup).toContain("loadingStateSpinner");
  });

  it("renders default hero title when feed is ready and empty", () => {
    vi.mocked(useProjectsWorkspace).mockReturnValue({
      ...baseWorkspace,
      featuredFeedStatus: "ready",
      latestFeaturedPosts: []
    } as never);

    const markup = renderToStaticMarkup(
      <ProjectsWorkspaceShell viewport={<div />} />
    );
    expect(markup).toContain("A calmer way to see what the studio is carrying.");
    expect(markup).not.toContain("projectsHeroFeedLoading");
  });
});
```

Adjust the mock `as never` cast if the context type adds required fields — include every field `ProjectsWorkspaceShell` destructures (`status`, `domainAllowed`, `latestFeaturedPosts`, `createDialogRef`, `projectForm`, `setProjectForm`, `clients`, `isCreatingProject`, `createProject`, `setStatus`, `featuredFeedStatus`).

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/unit/projects-workspace-shell-hero.test.tsx`  
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/projects-workspace-shell-hero.test.tsx
git commit -m "test(projects): cover hero loading vs ready fallback copy"
```

---

## Verification

- [ ] `npx tsc --noEmit` — clean  
- [ ] `npx vitest run tests/unit/projects-workspace-shell-hero.test.tsx` — pass  
- [ ] `npm run test` — pass if your branch policy requires full suite  
- [ ] Manual: load projects home with network throttling — hero should show 16:9 + spinners, then either feed content or full default copy, **without** a flash of default copy during the initial request  

---

## Self-review (plan)

1. **Spec coverage:** Loading state + 16:9 + existing spinner class + default copy only after ready + empty/error fallback — all mapped to tasks.  
2. **Placeholders:** None intentional.  
3. **Consistency:** `featuredFeedStatus` name used everywhere; shell constants match existing strings.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-03-remove-hero-feed-loading-flash.md`. Two execution options:**

**1. Subagent-driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**

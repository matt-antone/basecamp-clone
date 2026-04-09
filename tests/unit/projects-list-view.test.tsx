import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectsListView } from "@/components/projects/projects-list-view";

const PROJECT_COLUMNS = [
  { key: "new" as const, title: "New", subtitle: "Ready to shape" },
  { key: "in_progress" as const, title: "In Progress", subtitle: "Actively moving" },
  { key: "blocked" as const, title: "Blocked", subtitle: "Needs a decision" },
  { key: "complete" as const, title: "Complete", subtitle: "Ready to file away" }
];

describe("ProjectsListView", () => {
  it("renders grouped project rows for populated list view", () => {
    const markup = renderToStaticMarkup(
      <ProjectsListView
        items={[
          {
            id: "project-1",
            name: "Launch",
            display_name: "ABC-2026 Launch",
            description: "Prepare release",
            tags: ["q2"],
            archived: false,
            client_id: "client-1",
            client_name: "Acme",
            status: "in_progress",
            discussion_count: 3,
            file_count: 5,
            created_at: "2025-06-15T12:00:00.000Z"
          }
        ]}
        projectColumns={PROJECT_COLUMNS}
        activeTab="list"
        hasSearchOrFilter={false}
        highlightedProjectId={null}
        emptyState="No active projects yet."
        onOpenCreateDialog={vi.fn()}
        onHighlightProject={vi.fn()}
        onProjectBlur={vi.fn()}
        renderProjectTitle={(value) => value}
        getProjectStatusLabel={() => "In Progress"}
        getProjectClientLabel={(project) => project.client_name ?? "No client"}
      />
    );

    expect(markup).toContain('class="clientLedgerSection"');
    expect(markup).toContain(">Acme<");
    expect(markup).toContain(">ABC-2026 Launch<");
    expect(markup).toContain("3 discussions · 5 files");
    expect(markup).toContain('class="projectCreatedMeta"');
    expect(markup).toContain("2025-06-15T12:00:00.000Z");
    expect(markup).toContain(">New project<");
  });

  it("shows create CTA in empty active list state", () => {
    const markup = renderToStaticMarkup(
      <ProjectsListView
        items={[]}
        projectColumns={PROJECT_COLUMNS}
        activeTab="list"
        hasSearchOrFilter={false}
        highlightedProjectId={null}
        emptyState="No active projects yet."
        onOpenCreateDialog={vi.fn()}
        onHighlightProject={vi.fn()}
        onProjectBlur={vi.fn()}
        renderProjectTitle={(value) => value}
        getProjectStatusLabel={() => "New"}
        getProjectClientLabel={() => "No client"}
      />
    );

    expect(markup).toContain(">No active projects yet.<");
    expect(markup).toContain(">New project<");
  });

  it("hides create CTA in archived empty state", () => {
    const markup = renderToStaticMarkup(
      <ProjectsListView
        items={[]}
        projectColumns={PROJECT_COLUMNS}
        activeTab="archived"
        hasSearchOrFilter={false}
        highlightedProjectId={null}
        emptyState="No archived projects are parked here yet."
        onOpenCreateDialog={vi.fn()}
        onHighlightProject={vi.fn()}
        onProjectBlur={vi.fn()}
        renderProjectTitle={(value) => value}
        getProjectStatusLabel={() => "New"}
        getProjectClientLabel={() => "No client"}
      />
    );

    expect(markup).toContain(">No archived projects are parked here yet.<");
    expect(markup).not.toContain(">New project<");
  });
});

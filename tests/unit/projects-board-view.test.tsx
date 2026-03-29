import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectsBoardView } from "@/components/projects/projects-board-view";

const PROJECT_COLUMNS = [
  { key: "new" as const, title: "New", subtitle: "Ready to shape" },
  { key: "in_progress" as const, title: "In Progress", subtitle: "Actively moving" },
  { key: "blocked" as const, title: "Blocked", subtitle: "Needs a decision" },
  { key: "complete" as const, title: "Complete", subtitle: "Ready to file away" }
];

describe("ProjectsBoardView", () => {
  it("renders board columns and cards", () => {
    const markup = renderToStaticMarkup(
      <ProjectsBoardView
        items={[
          {
            id: "project-1",
            name: "Campaign",
            display_name: "ABC-2026 Campaign",
            description: "Plan launch",
            tags: ["launch"],
            client_id: "client-1",
            client_name: "Acme",
            archived: false,
            status: "in_progress"
          }
        ]}
        projectColumns={PROJECT_COLUMNS}
        dragOverColumn={null}
        draggingProjectId={null}
        justMovedProjectId={null}
        justUpdatedColumn={null}
        renderProjectTitle={(value) => value}
        onColumnDragOver={vi.fn()}
        onColumnDragLeave={vi.fn()}
        onColumnDrop={vi.fn()}
        onCardDragStart={vi.fn()}
        onCardDragEnd={vi.fn()}
        onArchiveProject={vi.fn()}
      />
    );

    expect(markup).toContain('class="projectFlowGrid"');
    expect(markup).toContain(">In Progress<");
    expect(markup).toContain(">ABC-2026 Campaign<");
    expect(markup).toContain(">Archive<");
  });
});

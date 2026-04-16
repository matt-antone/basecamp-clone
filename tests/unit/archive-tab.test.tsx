import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ClientRecord } from "@/lib/types/client-record";

vi.mock("@/lib/browser-auth", () => ({
  authedJsonFetch: vi.fn(() => new Promise(() => {}))
}));

vi.mock("@/components/projects/projects-workspace-context", () => ({
  useProjectsWorkspace: () => ({ clients: mockClients })
}));

let mockClients: ClientRecord[] = [];

function makeClient(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    id: overrides.id ?? "client",
    name: overrides.name ?? "Client",
    code: overrides.code ?? "CLT",
    github_repos: [],
    domains: [],
    created_at: "2026-01-01T00:00:00.000Z",
    archived_at: null,
    ...overrides
  };
}

async function renderArchiveTab() {
  const { ArchiveTab } = await import("@/components/projects/archive-tab");
  return renderToStaticMarkup(
    <ArchiveTab
      accessToken="test-token"
      onToken={() => {}}
      onRestore={async () => {}}
      onOpenCreateDialog={() => {}}
    />
  );
}

describe("ArchiveTab client filter", () => {
  it("renders the default 'All clients' option", async () => {
    mockClients = [];
    const markup = await renderArchiveTab();
    expect(markup).toContain('aria-label="Filter archived projects by client"');
    expect(markup).toContain(">All clients<");
  });

  it("renders client names sorted alphabetically from workspace context", async () => {
    mockClients = [
      makeClient({ id: "c-b", name: "Bravo" }),
      makeClient({ id: "c-a", name: "Acme" })
    ];
    const markup = await renderArchiveTab();
    const acmeIdx = markup.indexOf(">Acme<");
    const bravoIdx = markup.indexOf(">Bravo<");
    expect(acmeIdx).toBeGreaterThan(-1);
    expect(bravoIdx).toBeGreaterThan(-1);
    expect(acmeIdx).toBeLessThan(bravoIdx);
  });

  it("appends ' (Archived)' to archived client labels", async () => {
    mockClients = [
      makeClient({ id: "c-a", name: "Acme" }),
      makeClient({
        id: "c-z",
        name: "Zephyr",
        archived_at: "2026-03-01T00:00:00.000Z"
      })
    ];
    const markup = await renderArchiveTab();
    expect(markup).toContain(">Zephyr (Archived)<");
    expect(markup).toContain(">Acme<");
    expect(markup).not.toContain(">Acme (Archived)<");
  });

  it("renders the selector inside the filter toolbar markup", async () => {
    mockClients = [makeClient({ id: "c-a", name: "Acme" })];
    const markup = await renderArchiveTab();
    expect(markup).toContain('class="projectsFilterToolbar"');
    expect(markup).toContain('class="projectsFilterField projectsClientFilterField"');
    expect(markup).toContain('class="projectsClientSelect"');
  });
});

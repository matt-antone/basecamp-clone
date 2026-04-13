import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsPageContent } from "@/app/settings/page";
import type { ClientRecord } from "@/lib/types/client-record";

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

const activeClient = (suffix: string, name: string) =>
  makeClient({ id: `a-${suffix}`, code: `A${suffix}`, name });

const archivedClient = (suffix: string, name: string) =>
  makeClient({
    id: `z-${suffix}`,
    code: `Z${suffix}`,
    name,
    archived_at: "2026-03-01T00:00:00.000Z"
  });

const BASE_INITIAL = {
  token: "test-token",
  googleAvatarUrl: "",
  status: "",
  profile: {
    email: "",
    firstName: "",
    lastName: "",
    avatarUrl: "",
    jobTitle: "",
    timezone: "",
    bio: ""
  },
  siteSettings: {
    siteTitle: "",
    logoUrl: "",
    defaultHourlyRateUsd: "150.00"
  }
};

describe("SettingsPageContent clients filter", () => {
  it("renders a tablist with active and archived counts", () => {
    const markup = renderToStaticMarkup(
      <SettingsPageContent
        initial={{
          ...BASE_INITIAL,
          clients: [
            activeClient("1", "Acme"),
            activeClient("2", "Bravo"),
            activeClient("3", "Charlie"),
            archivedClient("1", "Delta")
          ]
        }}
      />
    );
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Client filter"');
    expect(markup).toContain("Active ");
    expect(markup).toContain("(3)");
    expect(markup).toContain("Archived ");
    expect(markup).toContain("(1)");
  });

  it("defaults to the active tab with aria-selected=true on Active and shows only active clients", () => {
    const markup = renderToStaticMarkup(
      <SettingsPageContent
        initial={{
          ...BASE_INITIAL,
          clients: [activeClient("1", "Acme Active"), archivedClient("1", "Bravo Archived")]
        }}
      />
    );
    expect(markup).toContain("Acme Active");
    expect(markup).not.toContain("Bravo Archived");
    expect(markup).toMatch(/aria-selected="true"[^>]*>\s*Active\s/);
    expect(markup).toMatch(/aria-selected="false"[^>]*>\s*Archived\s/);
  });

  it("shows the onboarding empty state when there are zero clients total", () => {
    const markup = renderToStaticMarkup(
      <SettingsPageContent initial={{ ...BASE_INITIAL, clients: [] }} />
    );
    expect(markup).toContain("No clients yet. Add your first client");
  });

  it("shows 'No active clients.' when every client is archived and the Active tab is default", () => {
    const markup = renderToStaticMarkup(
      <SettingsPageContent
        initial={{ ...BASE_INITIAL, clients: [archivedClient("1", "Bravo Archived")] }}
      />
    );
    expect(markup).toContain("No active clients.");
    expect(markup).not.toContain("Bravo Archived");
    expect(markup).toContain("(0)");
    expect(markup).toContain("(1)");
  });

  it("shows (0) archived count badge when every client is active", () => {
    const markup = renderToStaticMarkup(
      <SettingsPageContent
        initial={{
          ...BASE_INITIAL,
          clients: [
            activeClient("1", "Acme"),
            activeClient("2", "Bravo"),
            activeClient("3", "Charlie")
          ]
        }}
      />
    );
    // Active count badge reflects total, archived count badge shows (0)
    expect(markup).toContain("(3)");
    // Verify the zero appears inside the archived-tab count span, not just anywhere
    expect(markup).toMatch(/Archived\s*<span[^>]*>\(0\)<\/span>/);
  });

  it("keeps a client with dropbox_archive_status 'archiving' visible in the Active list (archived_at still null)", () => {
    const inFlightClient = makeClient({
      id: "inflight-1",
      name: "In-Flight Corp",
      code: "IFC",
      archived_at: null,
      dropbox_archive_status: "archiving"
    });
    const markup = renderToStaticMarkup(
      <SettingsPageContent
        initial={{
          ...BASE_INITIAL,
          clients: [inFlightClient, activeClient("2", "Other Active")]
        }}
      />
    );
    // The client whose Dropbox archive is in progress but whose archived_at is null
    // must still appear in the Active list (pollingIds behaviour requires this).
    expect(markup).toContain("In-Flight Corp");
    expect(markup).toContain("Other Active");
    // Both are active — count badge should read (2)
    expect(markup).toMatch(/Active\s*<span[^>]*>\(2\)<\/span>/);
  });
});

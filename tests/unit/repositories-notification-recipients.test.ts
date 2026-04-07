import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

vi.mock("@/lib/db", () => ({
  query: queryMock
}));

describe("listNotificationRecipients", () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
    process.env.WORKSPACE_DOMAIN = "glyphix.com";
  });

  it("filters by active users in workspace and requests deduped emails", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const { listNotificationRecipients } = await import("@/lib/repositories");
    await listNotificationRecipients("user-1");

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("where active = true");
    expect(sql).toContain("distinct on (lower(email))");
    expect(sql).not.toContain("id <>");
    expect(params).toEqual(["glyphix.com"]);
  });

  it("maps database rows to notification recipients", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: "user-2",
          email: "jamie@glyphix.com",
          firstName: "Jamie",
          lastName: "Teammate"
        }
      ]
    });

    const { listNotificationRecipients } = await import("@/lib/repositories");
    const recipients = await listNotificationRecipients("user-1");

    expect(recipients).toEqual([
      {
        id: "user-2",
        email: "jamie@glyphix.com",
        firstName: "Jamie",
        lastName: "Teammate"
      }
    ]);
  });
});

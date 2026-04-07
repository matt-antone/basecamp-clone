import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("mailer", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    process.env.DATABASE_URL = "postgres://localhost/postgres";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.WORKSPACE_DOMAIN = "example.com";
    process.env.EMAIL_ENABLED = "true";
    process.env.EMAIL_FROM = "notifications@example.com";
    process.env.MAILGUN_API_KEY = "key-test-123";
    process.env.MAILGUN_DOMAIN = "mg.example.com";
    process.env.MAILGUN_BASE_URL = "https://api.mailgun.net";
  });

  it("skips sending when email is disabled", async () => {
    process.env.EMAIL_ENABLED = "false";
    const { sendMail } = await import("@/lib/mailer");

    const result = await sendMail({
      recipients: [{ email: "teammate@example.com", name: "Teammate" }],
      subject: "Subject",
      text: "Text body",
      html: "<p>Text body</p>"
    });

    expect(result).toEqual({ skipped: true, reason: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders expected subject, text, recipients, and message id for thread emails", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "<20260407.1@mailgun.test>" })
    });

    const { resetMailerForTests, sendThreadCreatedEmail } = await import("@/lib/mailer");
    resetMailerForTests();

    const result = await sendThreadCreatedEmail({
      recipients: [{ email: "teammate@example.com", name: "Jamie Teammate" }],
      actor: { name: "Alex Author", email: "alex@example.com" },
      project: { id: "project-1", name: "Blue Sky" },
      thread: { id: "thread-1", title: "Kickoff notes" },
      threadUrl: "https://app.example.com/project-1/thread-1"
    });

    expect(result).toEqual({
      skipped: false,
      recipientCount: 1,
      messageId: "<20260407.1@mailgun.test>"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mailgun.net/v3/mg.example.com/messages");
    expect(request.method).toBe("POST");
    expect((request.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("api:key-test-123").toString("base64")}`
    );

    const body = new URLSearchParams(String(request.body));
    expect(body.get("from")).toBe("notifications@example.com");
    expect(body.getAll("to")).toEqual(['"Jamie Teammate" <teammate@example.com>']);
    expect(body.get("subject")).toBe("[Blue Sky] New discussion: Kickoff notes");
    expect(body.get("text")).toContain("Open: https://app.example.com/project-1/thread-1");
  });

  it("maps replyTo to h:Reply-To", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "<20260407.2@mailgun.test>" })
    });

    const { sendMail } = await import("@/lib/mailer");

    await sendMail({
      recipients: [{ email: "teammate@example.com" }],
      subject: "Subject",
      text: "Text body",
      html: "<p>Text body</p>",
      replyTo: "author@example.com"
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(String(request.body));
    expect(body.get("h:Reply-To")).toBe("author@example.com");
  });
});

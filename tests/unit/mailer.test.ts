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

  it("sendCommentUpdatedEmail: subject contains [label] and thread title", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-1>" }) });
    const { sendCommentUpdatedEmail } = await import("@/lib/mailer");
    const result = await sendCommentUpdatedEmail({
      recipients: [{ email: "a@example.com" }],
      actor: { name: "AI", email: "" },
      project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
      thread: { id: "t-1", title: "Design Review" },
      threadUrl: "https://app.example.com/p-1/t-1",
      comment: { id: "c-1", excerpt: "Looks good to me" },
    });
    expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("subject")).toBe("[AC-0001-Acme Site] Comment updated on: Design Review");
  });

  it("sendThreadUpdatedEmail: subject contains [label] and thread title", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-2>" }) });
    const { sendThreadUpdatedEmail } = await import("@/lib/mailer");
    const result = await sendThreadUpdatedEmail({
      recipients: [{ email: "a@example.com" }],
      actor: { name: "AI", email: "" },
      project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
      thread: { id: "t-1", title: "Design Review" },
      threadUrl: "https://app.example.com/p-1/t-1",
    });
    expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("subject")).toBe("[AC-0001-Acme Site] Discussion updated: Design Review");
  });

  it("sendProjectCreatedEmail: subject contains [label] and 'New project created'", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-3>" }) });
    const { sendProjectCreatedEmail } = await import("@/lib/mailer");
    const result = await sendProjectCreatedEmail({
      recipients: [{ email: "a@example.com" }],
      actor: { name: "AI", email: "" },
      project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
      projectUrl: "https://app.example.com/p-1",
    });
    expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("subject")).toBe("[AC-0001-Acme Site] New project created");
  });

  it("sendProjectUpdatedEmail: subject contains [label] and project name", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-4>" }) });
    const { sendProjectUpdatedEmail } = await import("@/lib/mailer");
    const result = await sendProjectUpdatedEmail({
      recipients: [{ email: "a@example.com" }],
      actor: { name: "AI", email: "" },
      project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
      projectUrl: "https://app.example.com/p-1",
    });
    expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("subject")).toBe("[AC-0001-Acme Site] Project updated: Acme Site");
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

  it("sendCommentUpdatedEmail: subject contains [label] and thread title", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-1>" }) });
    const { sendCommentUpdatedEmail } = await import("@/lib/mailer");
    const result = await sendCommentUpdatedEmail({
      recipients: [{ email: "a@example.com" }],
      actor: { name: "AI", email: "" },
      project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
      thread: { id: "t-1", title: "Design Review" },
      threadUrl: "https://app.example.com/p-1/t-1",
      comment: { id: "c-1", excerpt: "Looks good to me" },
    });
    expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("subject")).toBe("[AC-0001-Acme Site] Comment updated on: Design Review");
  });

  it("sendThreadUpdatedEmail: subject contains [label] and thread title", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-2>" }) });
    const { sendThreadUpdatedEmail } = await import("@/lib/mailer");
    const result = await sendThreadUpdatedEmail({
      recipients: [{ email: "a@example.com" }],
      actor: { name: "AI", email: "" },
      project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
      thread: { id: "t-1", title: "Design Review" },
      threadUrl: "https://app.example.com/p-1/t-1",
    });
    expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("subject")).toBe("[AC-0001-Acme Site] Discussion updated: Design Review");
  });

  it("sendProjectCreatedEmail: subject contains [label] and 'New project created'", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-3>" }) });
    const { sendProjectCreatedEmail } = await import("@/lib/mailer");
    const result = await sendProjectCreatedEmail({
      recipients: [{ email: "a@example.com" }],
      actor: { name: "AI", email: "" },
      project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
      projectUrl: "https://app.example.com/p-1",
    });
    expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("subject")).toBe("[AC-0001-Acme Site] New project created");
  });

  it("sendProjectUpdatedEmail: subject contains [label] and project name", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "<id-4>" }) });
    const { sendProjectUpdatedEmail } = await import("@/lib/mailer");
    const result = await sendProjectUpdatedEmail({
      recipients: [{ email: "a@example.com" }],
      actor: { name: "AI", email: "" },
      project: { id: "p-1", name: "Acme Site", client_code: "AC", project_code: "0001" },
      projectUrl: "https://app.example.com/p-1",
    });
    expect(result).toMatchObject({ skipped: false, recipientCount: 1 });
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("subject")).toBe("[AC-0001-Acme Site] Project updated: Acme Site");
  });
});

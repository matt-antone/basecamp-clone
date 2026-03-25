import { beforeEach, describe, expect, it, vi } from "vitest";

const createTransportMock = vi.fn();
const sendMailMock = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportMock
  }
}));

describe("mailer", () => {
  beforeEach(() => {
    vi.resetModules();
    createTransportMock.mockReset();
    sendMailMock.mockReset();
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });

    process.env.DATABASE_URL = "postgres://localhost/postgres";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.WORKSPACE_DOMAIN = "example.com";
    process.env.EMAIL_ENABLED = "true";
    process.env.EMAIL_FROM = "notifications@example.com";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USERNAME;
    delete process.env.SMTP_PASSWORD;
  });

  it("builds the correct default SMTP transport config", async () => {
    const { buildSmtpTransportOptions } = await import("@/lib/mailer");

    expect(buildSmtpTransportOptions()).toEqual({
      host: "smtp-relay.gmail.com",
      port: 587,
      secure: false
    });
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
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("renders expected subject, text, and recipients for thread emails", async () => {
    sendMailMock.mockResolvedValue({ messageId: "message-1" });
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
      messageId: "message-1"
    });
    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp-relay.gmail.com",
      port: 587,
      secure: false
    });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "notifications@example.com",
        subject: "[Blue Sky] New discussion: Kickoff notes",
        text: expect.stringContaining("Open: https://app.example.com/project-1/thread-1"),
        to: ['"Jamie Teammate" <teammate@example.com>']
      })
    );
  });
});
